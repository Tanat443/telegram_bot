import { MetaClient } from "../../src/meta.js";
import { readConfig } from "../../src/config.js";

const verifyToken = process.env.META_VERIFY_TOKEN || "verify-token";

export default async function handler(req, res) {
  if (req.method === "GET" && req.query.debug === "1") {
    res.status(200).json({
      ok: true,
      hasVerifyToken: Boolean(process.env.META_VERIFY_TOKEN),
      graphBaseUrl: process.env.META_GRAPH_BASE_URL || "https://graph.instagram.com",
      apiVersion: process.env.META_API_VERSION || "v24.0"
    });
    return;
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === verifyToken) {
      res.status(200).send(challenge || "");
      return;
    }

    res.status(403).json({ error: "Meta webhook verification failed" });
    return;
  }

  if (req.method === "POST") {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const meta = new MetaClient({
      accessToken: process.env.META_ACCESS_TOKEN || "",
      apiVersion: process.env.META_API_VERSION || "v24.0",
      graphBaseUrl: process.env.META_GRAPH_BASE_URL || "https://graph.instagram.com",
      configProvider: readConfig,
      telegramBot: {
        getStartUrl(payload = "ig") {
          if (!botUsername) {
            console.warn("TELEGRAM_BOT_USERNAME is empty; cannot build Telegram start URL.");
            return "";
          }
          return `https://t.me/${botUsername}?start=${encodeURIComponent(payload)}`;
        }
      }
    });

    await meta.handleWebhook(req.body || {});
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader("allow", "GET, POST");
  res.status(405).json({ error: "Method not allowed" });
}
