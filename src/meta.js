export class MetaClient {
  constructor({ accessToken, apiVersion, graphBaseUrl, configProvider, telegramBot }) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion || "v24.0";
    this.graphBaseUrl = (graphBaseUrl || "https://graph.instagram.com").replace(/\/$/, "");
    this.configProvider = configProvider;
    this.telegramBot = telegramBot;
  }

  async handleWebhook(body) {
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
      if (!commentId || !this.matchesKeywords(text, config.instagram.keywords)) continue;

      console.log(`Instagram comment trigger: ${commentId} "${text}"`);
      if (config.instagram.publicCommentReply) {
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
    const url = this.graphUrl(`/${commentId}/private_replies`);
    await this.postGraph(url, {
      message: `${config.instagram.directMessage.text}\n\n${this.telegramBot.getStartUrl(config.telegram.startPayload)}`
    });
  }

  async publicReplyToComment(commentId, message) {
    const url = this.graphUrl(`/${commentId}/replies`);
    await this.postGraph(url, { message });
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
    });
  }

  graphUrl(path) {
    return `${this.graphBaseUrl}/${this.apiVersion}${path}`;
  }

  async postGraph(url, payload) {
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
      console.error("Meta API error:", JSON.stringify(data));
      return;
    }
    console.log("Meta API sent:", JSON.stringify(data));
  }
}
