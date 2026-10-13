export class MetaClient {
  constructor({ accessToken, apiVersion, graphBaseUrl, configProvider, telegramBot }) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion || "v24.0";
    this.graphBaseUrl = (graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
    this.configProvider = configProvider;
    this.telegramBot = telegramBot;
  }

  async handleWebhook(body) {
    console.log("Meta webhook received:", JSON.stringify(summarizeWebhook(body)));

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
      if (!commentId || !this.matchesKeywords(text, config.instagram.keywords)) continue;
      if (isReply) {
        console.log(`Skipped reply comment: ${commentId}`);
        continue;
      }
      if (seenRecently(`comment:${commentId}`)) {
        console.log(`Skipped duplicate comment event: ${commentId}`);
        continue;
      }

      console.log(`Instagram comment trigger: ${commentId} "${text}"`);
      if (config.instagram.publicReplyEnabled === true && config.instagram.publicCommentReply) {
        await this.publicReplyToComment(commentId, config.instagram.publicCommentReply);
      }
      await this.privateReplyToComment(commentId, config);
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

      console.log(`Instagram DM trigger from ${senderId}`);
      await this.sendDirectMessage(senderId, config);
    }
  }

  matchesKeywords(text, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) return true;
    const normalized = String(text || "").toLowerCase();
    return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
  }

  async privateReplyToComment(commentId, config) {
    const url = this.graphUrl(`/me/messages`);
    await this.postGraph(url, {
      recipient: { comment_id: commentId },
      message: {
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
      }
    }, "private reply");
  }

  async publicReplyToComment(commentId, message) {
    const url = this.graphUrl(`/${commentId}/replies`);
    await this.postGraph(url, { message }, "public comment reply");
  }

  async sendDirectMessage(recipientId, config) {
    const url = this.graphUrl(`/me/messages`);
    await this.postGraph(url, {
      recipient: { id: recipientId },
      message: {
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
      }
    }, "direct message");
  }

  graphUrl(path) {
    return `${this.graphBaseUrl}/${this.apiVersion}${path}`;
  }

  async postGraph(url, payload, label = "Meta API request") {
    if (!this.accessToken) {
      console.warn("META_ACCESS_TOKEN is empty; skipped Meta API call.");
      return;
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
      return;
    }
    console.log(`${label} sent:`, JSON.stringify(data));
  }
}

const recentEvents = new Map();
const RECENT_EVENT_TTL_MS = 10 * 60 * 1000;

function seenRecently(key) {
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
