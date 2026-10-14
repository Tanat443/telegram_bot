import { hasInstagramRecipient, markEventOnce, markInstagramRecipientOnce, recordEvent } from "./db.js";

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
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      await this.handleCommentChanges(entry, config);
      await this.handleMessagingEvents(entry, config);
    }
  }

  async handleCommentChanges(entry, config) {
    if (!config.instagram.enabledTriggers.comments) return;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      if (change.field !== "comments") continue;
      const value = change.value || {};
      const commentId = value.id || value.comment_id;
      const text = value.text || value.message || "";
      const isReply = Boolean(value.parent_id);
      const actorId = getCommentActorId(value);
      if (!commentId || !this.matchesKeywords(text, config.instagram.keywords)) continue;
      if (isReply) {
        console.log(`Skipped reply comment: ${commentId}`);
        await recordEvent("instagram_comment_reply_skipped", { commentId });
        continue;
      }
      if (await seenRecently(`comment:${commentId}`)) {
        console.log(`Skipped duplicate comment event: ${commentId}`);
        await recordEvent("instagram_comment_duplicate_skipped", { commentId });
        continue;
      }

      const recipientKey = actorId ? `instagram:${actorId}` : "";
      if (actorId) {
        const alreadyContacted = await hasInstagramRecipient(recipientKey);
        if (alreadyContacted === true) {
          console.log(`Skipped already contacted Instagram commenter: ${actorId}`);
          await recordEvent("instagram_recipient_duplicate_skipped", {
            source: "comment",
            instagramUserId: actorId,
            commentId
          });
          continue;
        }
      }

      console.log(`Instagram comment trigger: ${commentId} "${text}"`);
      await recordEvent("instagram_comment_received", {
        commentId,
        text,
        mediaId: value.media?.id || value.media_id || "",
        fromId: actorId || ""
      });
      if (config.instagram.publicReplyEnabled === true && config.instagram.publicCommentReply) {
        await this.publicReplyToComment(commentId, config.instagram.publicCommentReply);
      }
      const sent = await this.privateReplyToComment(commentId, config);
      if (sent && recipientKey) {
        await markInstagramRecipientOnce(recipientKey, {
          source: "comment",
          instagramUserId: actorId,
          firstCommentId: commentId,
          mediaId: value.media?.id || value.media_id || ""
        });
      }
    }
  }

  async handleMessagingEvents(entry, config) {
    if (!config.instagram.enabledTriggers.directMessages && !config.instagram.enabledTriggers.shares) return;
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const event of events) {
      const senderId = event.sender?.id;
      const message = event.message;
      if (!senderId || !message) continue;

      const text = message.text || "";
      const hasShare = Boolean(message.attachments?.some((item) => item.type === "share"));
      const allowedText = config.instagram.enabledTriggers.directMessages && this.matchesKeywords(text, config.instagram.keywords);
      const allowedShare = config.instagram.enabledTriggers.shares && hasShare;
      if (!allowedText && !allowedShare) continue;

      const recipientKey = `instagram:${senderId}`;
      const alreadyContacted = await hasInstagramRecipient(recipientKey);
      if (alreadyContacted === true) {
        console.log(`Skipped already contacted Instagram DM sender: ${senderId}`);
        await recordEvent("instagram_recipient_duplicate_skipped", {
          source: "direct_message",
          instagramUserId: senderId,
          hasShare
        });
        continue;
      }

      console.log(`Instagram DM trigger from ${senderId}`);
      await recordEvent("instagram_direct_message_received", {
        senderId,
        hasShare,
        text
      });
      const sent = await this.sendDirectMessage(senderId, config);
      if (sent) {
        await markInstagramRecipientOnce(recipientKey, {
          source: "direct_message",
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

  async privateReplyToComment(commentId, config) {
    const url = this.graphUrl(`/me/messages`);
    const withImage = this.instagramMessagePayload(config);
    const sent = await this.postGraph(url, {
      recipient: { comment_id: commentId },
      message: withImage
    }, "private reply");
    if (sent || !config.instagram.directMedia?.imageId) return sent;

    return this.postGraph(url, {
      recipient: { comment_id: commentId },
      message: this.instagramButtonMessage(config)
    }, "private reply fallback");
  }

  async publicReplyToComment(commentId, message) {
    const url = this.graphUrl(`/${commentId}/replies`);
    await this.postGraph(url, { message }, "public comment reply");
  }

  async sendDirectMessage(recipientId, config) {
    const url = this.graphUrl(`/me/messages`);
    const sent = await this.postGraph(url, {
      recipient: { id: recipientId },
      message: this.instagramMessagePayload(config)
    }, "direct message");
    if (sent || !config.instagram.directMedia?.imageId) return sent;

    return this.postGraph(url, {
      recipient: { id: recipientId },
      message: this.instagramButtonMessage(config)
    }, "direct message fallback");
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

  async postGraph(url, payload, label = "Meta API request") {
    if (!this.accessToken) {
      console.warn("META_ACCESS_TOKEN is empty; skipped Meta API call.");
      await recordEvent("meta_api_skipped", { label, reason: "missing_access_token" });
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
        status: response.status,
        response: data
      });
      return false;
    }
    console.log(`${label} sent:`, JSON.stringify(data));
    await recordEvent("meta_api_sent", { label, response: data });
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

function truncateForMeta(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
