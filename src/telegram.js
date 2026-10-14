import { normalizeUrl } from "./config.js";
import { recordEvent, upsertTelegramUser } from "./db.js";

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
    if (!this.token) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }

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
    console.log("Telegram update received:", JSON.stringify({
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      hasCallback: Boolean(update.callback_query),
      callbackData: update.callback_query?.data
    }));
    await recordEvent("telegram_update_received", {
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      hasCallback: Boolean(update.callback_query),
      callbackData: update.callback_query?.data
    });

    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  async handleMessage(message) {
    const text = message.text || "";
    if (text.startsWith("/start")) {
      const config = await this.configProvider();
      console.log(`Telegram /start from ${message.from?.id}`);
      await upsertTelegramUser(message.from, {
        lastStartAt: new Date(),
        lastChatId: message.chat.id
      });
      await recordEvent("telegram_started", {
        telegramId: message.from?.id,
        chatId: message.chat.id,
        text
      });
      await this.sendWelcome(message.chat.id, config);
      return;
    }

    await this.api("sendMessage", {
      chat_id: message.chat.id,
      text: "Нажмите /start, чтобы получить доступ."
    });
  }

  async sendWelcome(chatId, config) {
    const imageId = config.telegramMedia?.welcomeImageId;
    if (imageId && process.env.PUBLIC_BASE_URL) {
      await this.api("sendPhoto", {
        chat_id: chatId,
        photo: `${normalizeUrl(process.env.PUBLIC_BASE_URL).replace(/\/$/, "")}/media/${imageId}`,
        caption: truncateCaption(config.telegramTexts.welcome),
        reply_markup: this.subscriptionKeyboard(config)
      });
      return;
    }

    await this.api("sendMessage", {
      chat_id: chatId,
      text: config.telegramTexts.welcome,
      reply_markup: this.subscriptionKeyboard(config)
    });
  }

  async handleCallback(callback) {
    const config = await this.configProvider();
    if (callback.data !== "check_subscription") return;

    await this.api("answerCallbackQuery", { callback_query_id: callback.id });
    const userId = callback.from.id;
    const subscribed = await this.isSubscribed(config.telegram.channelUsername, userId);
    console.log(`Telegram subscription check: user=${userId} channel=${config.telegram.channelUsername} subscribed=${subscribed}`);
    await upsertTelegramUser(callback.from, {
      lastSubscriptionCheckAt: new Date(),
      lastSubscriptionStatus: subscribed,
      channelUsername: config.telegram.channelUsername
    });
    await recordEvent("telegram_subscription_checked", {
      telegramId: userId,
      chatId: callback.message.chat.id,
      channelUsername: config.telegram.channelUsername,
      subscribed
    });

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

function truncateCaption(text) {
  const value = String(text || "");
  return value.length > 1024 ? `${value.slice(0, 1021)}...` : value;
}
