import { readConfig } from "../../src/config.js";
import { TelegramBot } from "../../src/telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      route: "/api/webhooks/telegram",
      hasToken: Boolean(token),
      hasWebhookSecret: Boolean(webhookSecret)
    });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (webhookSecret && req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret) {
    res.status(403).json({ error: "Telegram webhook secret mismatch" });
    return;
  }

  const bot = new TelegramBot({
    token,
    configProvider: readConfig,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || ""
  });

  await bot.handleUpdate(req.body || {});
  res.status(200).json({ ok: true });
}
