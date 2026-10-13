import { normalizeUrl } from "./config.js";

const TELEGRAM_API = "https://api.telegram.org/bot";

export class TelegramBot {
  constructor({ token, configProvider, botUsername }) {
    this.token = token;
    this.configProvider = configProvider;
    this.botUsername = botUsername || "";
    this.offset = 0;
    this.stopped = false;
  }

  async api(method, payload = {}) {
    const response = await fetch(`${TELEGRAM_API}${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description || "unknown error"}`);
    }
    return data.result;
  }

  async init() {
    if (!this.botUsername) {
      const me = await this.api("getMe");
      this.botUsername = me.username;
    }
    console.log(`Telegram bot ready: @${this.botUsername}`);
  }

  getStartUrl(payload = "ig") {
    return `https://t.me/${this.botUsername}?start=${encodeURIComponent(payload)}`;
  }

  async startPolling() {
    while (!this.stopped) {
      try {
        const updates = await this.api("getUpdates", {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"]
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error(error.message);
        await sleep(2000);
      }
    }
  }

  async handleUpdate(update) {
    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  async handleMessage(message) {
    const text = message.text || "";
    if (text.startsWith("/start")) {
      const config = await this.configProvider();
      await this.api("sendMessage", {
        chat_id: message.chat.id,
        text: config.telegramTexts.welcome,
        reply_markup: this.subscriptionKeyboard(config)
      });
      return;
    }

    await this.api("sendMessage", {
      chat_id: message.chat.id,
      text: "Нажмите /start, чтобы получить доступ."
    });
  }

  async handleCallback(callback) {
    const config = await this.configProvider();
    if (callback.data !== "check_subscription") return;

    await this.api("answerCallbackQuery", { callback_query_id: callback.id });
    const userId = callback.from.id;
    const subscribed = await this.isSubscribed(config.telegram.channelUsername, userId);

    if (!subscribed) {
      await this.api("sendMessage", {
        chat_id: callback.message.chat.id,
        text: config.telegramTexts.notSubscribed,
        reply_markup: this.subscriptionKeyboard(config)
      });
      return;
    }

    await this.api("sendMessage", {
      chat_id: callback.message.chat.id,
      text: `${config.telegramTexts.subscribed}\n${normalizeUrl(config.landingUrl)}`,
      reply_markup: {
        inline_keyboard: [[
          { text: config.telegramTexts.landingButton, url: normalizeUrl(config.landingUrl) }
        ]]
      }
    });
  }

  async isSubscribed(channelUsername, userId) {
    try {
      const member = await this.api("getChatMember", {
        chat_id: channelUsername,
        user_id: userId
      });
      return ["creator", "administrator", "member"].includes(member.status);
    } catch (error) {
      console.error(`Subscription check failed: ${error.message}`);
      return false;
    }
  }

  subscriptionKeyboard(config) {
    return {
      inline_keyboard: [
        [{ text: config.telegramTexts.channelButton, url: `https://t.me/${config.telegram.channelUsername.replace(/^@/, "")}` }],
        [{ text: config.telegramTexts.checkButton, callback_data: "check_subscription" }]
      ]
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
