import { hasInstagramRecipient, markEventOnce, markInstagramRecipientOnce, recordEvent } from "./db.js";
import { mergeConfigWithCampaign, readCampaigns } from "./config.js";

export class MetaClient {
  constructor({ accessToken, apiVersion, graphBaseUrl, publicBaseUrl, configProvider, telegramBot }) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion || "v24.0";
    this.graphBaseUrl = (graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
    this.publicBaseUrl = (publicBaseUrl || "").replace(/\/$/, "");
    this.configProvider = configProvider;
    this.telegramBot = telegramBot;
  }

  async handleWebhook(body) {
    console.log("Meta webhook received:", JSON.stringify(summarizeWebhook(body)));
    await recordEvent("meta_webhook_received", summarizeWebhook(body));

    const config = await this.configProvider();
    const campaigns = await readCampaigns(config);
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      await this.handleCommentChanges(entry, config, campaigns);
      await this.handleMessagingEvents(entry, config, campaigns);
    }
  }

  async handleCommentChanges(entry, config, campaigns) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      if (change.field !== "comments") continue;
      const value = change.value || {};
      const commentId = value.id || value.comment_id;
      const text = value.text || value.message || "";
      const isReply = Boolean(value.parent_id);
      const actorId = getCommentActorId(value);
      const mediaId = getCommentMediaId(value);
      const campaign = this.findCommentCampaign(campaigns, mediaId, text);
      if (!commentId || !campaign) continue;
      const campaignConfig = mergeConfigWithCampaign(config, campaign);
      if (isReply) {
        console.log(`Skipped reply comment: ${commentId}`);
        await recordEvent("instagram_comment_reply_skipped", campaignEvent(campaign, { commentId, mediaId }));
        continue;
      }
      if (await seenRecently(`comment:${commentId}`)) {
        console.log(`Skipped duplicate comment event: ${commentId}`);
        await recordEvent("instagram_comment_duplicate_skipped", campaignEvent(campaign, { commentId, mediaId }));
        continue;
      }

      const recipientKey = actorId ? instagramRecipientKey(actorId, campaign.id) : "";
      if (actorId) {
        const alreadyContacted = await this.hasCampaignRecipient(actorId, campaign.id);
        if (alreadyContacted === true) {
          console.log(`Skipped already contacted Instagram commenter: ${actorId}; campaign=${campaign.id}`);
          await recordEvent("instagram_recipient_duplicate_skipped", campaignEvent(campaign, {
            source: "comment",
            instagramUserId: actorId,
            commentId,
            mediaId
          }));
          continue;
        }
      }

      console.log(`Instagram comment trigger: ${commentId}; campaign=${campaign.id}; "${text}"`);
      await recordEvent("instagram_comment_received", campaignEvent(campaign, {
        commentId,
        text,
        mediaId,
        fromId: actorId || ""
      }));
      if (campaignConfig.instagram.publicReplyEnabled === true && campaignConfig.instagram.publicCommentReply) {
        await this.publicReplyToComment(commentId, campaignConfig.instagram.publicCommentReply, campaign);
      }
      const sent = await this.privateReplyToComment(commentId, campaignConfig);
      if (sent && recipientKey) {
        await markInstagramRecipientOnce(recipientKey, {
          source: "comment",
          campaignId: campaign.id,
          campaignName: campaign.name,
          instagramUserId: actorId,
          firstCommentId: commentId,
          mediaId
        });
      }
    }
  }

  async handleMessagingEvents(entry, config, campaigns) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const event of events) {
      const senderId = event.sender?.id;
      const message = event.message;
      if (!senderId || !message) continue;

      const text = message.text || "";
      const hasShare = Boolean(message.attachments?.some((item) => item.type === "share"));
      const campaign = this.findMessagingCampaign(campaigns, text, hasShare);
      if (!campaign) continue;
      const campaignConfig = mergeConfigWithCampaign(config, campaign);

      const recipientKey = instagramRecipientKey(senderId, campaign.id);
      const alreadyContacted = await this.hasCampaignRecipient(senderId, campaign.id);
      if (alreadyContacted === true) {
        console.log(`Skipped already contacted Instagram DM sender: ${senderId}; campaign=${campaign.id}`);
        await recordEvent("instagram_recipient_duplicate_skipped", campaignEvent(campaign, {
          source: "direct_message",
          instagramUserId: senderId,
          hasShare
        }));
        continue;
      }

      console.log(`Instagram DM trigger from ${senderId}; campaign=${campaign.id}`);
      await recordEvent("instagram_direct_message_received", campaignEvent(campaign, {
        senderId,
        hasShare,
        text
      }));
      const sent = await this.sendDirectMessage(senderId, campaignConfig);
      if (sent) {
        await markInstagramRecipientOnce(recipientKey, {
          source: "direct_message",
          campaignId: campaign.id,
          campaignName: campaign.name,
          instagramUserId: senderId,
          hasShare
        });
      }
    }
  }

  matchesKeywords(text, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) return true;
    const normalized = String(text || "").toLowerCase();
    return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
  }

  findCommentCampaign(campaigns, mediaId, text) {
    return campaigns.find((campaign) => {
      if (!campaign.instagram.enabledTriggers.comments) return false;
      if (!this.matchesMedia(mediaId, campaign.mediaIds)) return false;
      return this.matchesKeywords(text, campaign.keywords);
    }) || null;
  }

  findMessagingCampaign(campaigns, text, hasShare) {
    return campaigns.find((campaign) => {
      const triggers = campaign.instagram.enabledTriggers;
      const allowedText = triggers.directMessages && this.matchesKeywords(text, campaign.keywords);
      const allowedShare = triggers.shares && hasShare;
      return allowedText || allowedShare;
    }) || null;
  }

  matchesMedia(mediaId, mediaIds) {
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) return true;
    if (!mediaId) return false;
    return mediaIds.includes(String(mediaId));
  }

  async hasCampaignRecipient(instagramUserId, campaignId) {
    const currentKey = instagramRecipientKey(instagramUserId, campaignId);
    const alreadyContacted = await hasInstagramRecipient(currentKey);
    if (alreadyContacted === true || campaignId !== "default") return alreadyContacted;

    return hasInstagramRecipient(`instagram:${instagramUserId}`);
  }

  async privateReplyToComment(commentId, config) {
    const url = this.graphUrl(`/me/messages`);
    const withImage = this.instagramMessagePayload(config);
    const sent = await this.postGraph(url, {
      recipient: { comment_id: commentId },
      message: withImage
    }, "private reply", config.campaign || null);
    if (sent || !config.instagram.directMedia?.imageId) return sent;

    return this.postGraph(url, {
      recipient: { comment_id: commentId },
      message: this.instagramButtonMessage(config)
    }, "private reply fallback", config.campaign || null);
  }

  async publicReplyToComment(commentId, message, campaign = null) {
    const url = this.graphUrl(`/${commentId}/replies`);
    await this.postGraph(url, { message }, "public comment reply", campaign);
  }

  async sendDirectMessage(recipientId, config) {
    const url = this.graphUrl(`/me/messages`);
    const sent = await this.postGraph(url, {
      recipient: { id: recipientId },
      message: this.instagramMessagePayload(config)
    }, "direct message", config.campaign || null);
    if (sent || !config.instagram.directMedia?.imageId) return sent;

    return this.postGraph(url, {
      recipient: { id: recipientId },
      message: this.instagramButtonMessage(config)
    }, "direct message fallback", config.campaign || null);
  }

  instagramMessagePayload(config) {
    const imageId = config.instagram.directMedia?.imageId;
    if (imageId && this.publicBaseUrl) {
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: truncateForMeta(config.instagram.directMessage.text, 80),
              image_url: `${this.publicBaseUrl}/media/${imageId}`,
              buttons: [{
                type: "web_url",
                title: config.instagram.directMessage.buttonText,
                url: this.telegramBot.getStartUrl(config.telegram.startPayload)
              }]
            }]
          }
        }
      };
    }

    return this.instagramButtonMessage(config);
  }

  instagramButtonMessage(config) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: config.instagram.directMessage.text,
          buttons: [{
            type: "web_url",
            title: config.instagram.directMessage.buttonText,
            url: this.telegramBot.getStartUrl(config.telegram.startPayload)
          }]
        }
      }
    };
  }

  graphUrl(path) {
    return `${this.graphBaseUrl}/${this.apiVersion}${path}`;
  }

  async fetchMediaList(limit = 50) {
    if (!this.accessToken) {
      throw new Error("META_ACCESS_TOKEN is empty");
    }

    const url = new URL(this.graphUrl("/me/media"));
    url.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("access_token", this.accessToken);

    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Instagram media sync failed: ${data.error?.message || response.status}`);
    }

    return Array.isArray(data.data) ? data.data : [];
  }

  async postGraph(url, payload, label = "Meta API request", eventPayload = {}) {
    const eventContext = campaignEvent(eventPayload);
    if (!this.accessToken) {
      console.warn("META_ACCESS_TOKEN is empty; skipped Meta API call.");
      await recordEvent("meta_api_skipped", { label, reason: "missing_access_token", ...eventContext });
      return false;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, access_token: this.accessToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`${label} failed:`, JSON.stringify({
        url,
        status: response.status,
        response: data
      }));
      await recordEvent("meta_api_failed", {
        label,
        ...eventContext,
        status: response.status,
        response: data
      });
      return false;
    }
    console.log(`${label} sent:`, JSON.stringify(data));
    await recordEvent("meta_api_sent", { label, ...eventContext, response: data });
    return true;
  }
}

const recentEvents = new Map();
const RECENT_EVENT_TTL_MS = 10 * 60 * 1000;

async function seenRecently(key) {
  const stored = await markEventOnce(key, RECENT_EVENT_TTL_MS / 1000);
  if (stored !== null) return !stored;

  const now = Date.now();
  for (const [eventKey, expiresAt] of recentEvents.entries()) {
    if (expiresAt <= now) recentEvents.delete(eventKey);
  }
  if (recentEvents.has(key)) return true;
  recentEvents.set(key, now + RECENT_EVENT_TTL_MS);
  return false;
}

function summarizeWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  return {
    object: body?.object,
    entryCount: entries.length,
    entries: entries.map((entry) => ({
      id: entry.id,
      time: entry.time,
      changes: Array.isArray(entry.changes)
        ? entry.changes.map((change) => ({
            field: change.field,
            valueKeys: change.value ? Object.keys(change.value) : []
          }))
        : [],
      messagingCount: Array.isArray(entry.messaging) ? entry.messaging.length : 0
    }))
  };
}

function getCommentActorId(value) {
  return value.from?.id || value.user?.id || value.user_id || value.sender_id || "";
}

function getCommentMediaId(value) {
  return String(value.media?.id || value.media_id || value.media?.media_id || "");
}

function instagramRecipientKey(instagramUserId, campaignId) {
  return `instagram:${instagramUserId}:campaign:${campaignId || "default"}`;
}

function campaignEvent(campaign, payload = {}) {
  if (!campaign?.id && !campaign?.name) return payload;
  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    ...payload
  };
}

function truncateForMeta(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
