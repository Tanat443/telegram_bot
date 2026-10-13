import http from "node:http";
import Busboy from "busboy";
import { URL } from "node:url";
import { getEnv, loadDotEnv, normalizeUrl, readConfig, requireEnv, writeConfig } from "./config.js";
import { getMediaFile, getStats, hasMongo, saveMediaFile } from "./db.js";
import { MetaClient } from "./meta.js";
import { TelegramBot } from "./telegram.js";

await loadDotEnv();

const port = Number(getEnv("PORT", "3000"));
const adminPassword = getEnv("ADMIN_PASSWORD", "admin");
const verifyToken = getEnv("META_VERIFY_TOKEN", "verify-token");
const telegramWebhookSecret = getEnv("TELEGRAM_WEBHOOK_SECRET");

const telegram = new TelegramBot({
  token: requireEnv("TELEGRAM_BOT_TOKEN"),
  configProvider: readConfig,
  botUsername: getEnv("TELEGRAM_BOT_USERNAME")
});

await telegram.init();

const meta = new MetaClient({
  accessToken: getEnv("META_ACCESS_TOKEN"),
  apiVersion: getEnv("META_API_VERSION", "v24.0"),
  graphBaseUrl: getEnv("META_GRAPH_BASE_URL", "https://graph.instagram.com"),
  configProvider: readConfig,
  telegramBot: telegram
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return sendJson(res, 200, { ok: true, service: "instagram-telegram-gate" });
    }

    if (req.method === "GET" && url.pathname === "/privacy") {
      return sendHtml(res, renderPrivacyPolicy());
    }

    if (req.method === "GET" && url.pathname === "/terms") {
      return sendHtml(res, renderTerms());
    }

    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      return handleMedia(url, res);
    }

    if (req.method === "GET" && url.pathname === "/api/ping") {
      return sendJson(res, 200, {
        ok: true,
        service: "instagram-telegram-gate",
        route: "/api/ping"
      });
    }

    if (url.pathname === "/admin") {
      return handleAdmin(req, res);
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      return handleStats(url, res);
    }

    if (req.method === "GET" && url.pathname === "/telegram/set-webhook") {
      return setTelegramWebhook(url, req, res);
    }

    if (req.method === "GET" && url.pathname === "/telegram/webhook-info") {
      return getTelegramWebhookInfo(url, res);
    }

    if (req.method === "GET" && isMetaWebhookPath(url.pathname) && url.searchParams.get("debug") === "1") {
      return sendJson(res, 200, {
        ok: true,
        hasVerifyToken: Boolean(getEnv("META_VERIFY_TOKEN")),
        graphBaseUrl: getEnv("META_GRAPH_BASE_URL", "https://graph.instagram.com"),
        apiVersion: getEnv("META_API_VERSION", "v24.0")
      });
    }

    if (req.method === "GET" && isMetaWebhookPath(url.pathname)) {
      return verifyMetaWebhook(url, res);
    }

    if (req.method === "POST" && isMetaWebhookPath(url.pathname)) {
      const body = await readJson(req);
      await meta.handleWebhook(body);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && isTelegramWebhookPath(url.pathname)) {
      return sendJson(res, 200, {
        ok: true,
        route: url.pathname,
        hasWebhookSecret: Boolean(telegramWebhookSecret)
      });
    }

    if (req.method === "POST" && isTelegramWebhookPath(url.pathname)) {
      if (telegramWebhookSecret && req.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret) {
        return sendJson(res, 403, { error: "Telegram webhook secret mismatch" });
      }
      const body = await readJson(req);
      await telegram.handleUpdate(body);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`HTTP server listening on http://localhost:${port}`);
  console.log(`Admin UI: http://localhost:${port}/admin`);
});

if (shouldUseTelegramPolling()) {
  telegram.startPolling();
} else {
  console.log("Telegram polling disabled; use /webhooks/telegram.");
}

function isMetaWebhookPath(pathname) {
  return pathname === "/webhooks/meta" || pathname === "/api/webhooks/meta";
}

function isTelegramWebhookPath(pathname) {
  return pathname === "/webhooks/telegram" || pathname === "/api/webhooks/telegram";
}

function shouldUseTelegramPolling() {
  const explicit = getEnv("TELEGRAM_USE_POLLING");
  if (explicit) return explicit === "true";
  return getEnv("VERCEL") !== "1";
}

async function setTelegramWebhook(url, req, res) {
  if (url.searchParams.get("password") !== adminPassword) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const baseUrl = getEnv("PUBLIC_BASE_URL") || `https://${req.headers.host}`;
  const webhookUrl = `${normalizeUrl(baseUrl).replace(/\/$/, "")}/webhooks/telegram`;
  const payload = {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true
  };

  if (telegramWebhookSecret) {
    payload.secret_token = telegramWebhookSecret;
  }

  const result = await telegram.api("setWebhook", payload);
  return sendJson(res, 200, { ok: true, webhookUrl, result });
}

async function getTelegramWebhookInfo(url, res) {
  if (url.searchParams.get("password") !== adminPassword) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const info = await telegram.api("getWebhookInfo");
  return sendJson(res, 200, { ok: true, info });
}

async function handleAdmin(req, res) {
  if (req.method === "GET") {
    const config = await readConfig();
    return sendHtml(res, renderAdmin(config));
  }

  if (req.method === "POST") {
    const { fields: form, files } = await readFormData(req);
    if (form.password !== adminPassword) {
      return sendHtml(res, renderMessage("Неверный пароль", "/admin"), 401);
    }

    const config = await readConfig();
    config.landingUrl = normalizeUrl(form.landingUrl);
    config.telegram.channelUsername = form.channelUsername;
    config.telegram.startPayload = form.startPayload || "ig";
    config.instagram.enabledTriggers.comments = form.comments === "on";
    config.instagram.enabledTriggers.directMessages = form.directMessages === "on";
    config.instagram.enabledTriggers.shares = form.shares === "on";
    config.instagram.keywords = splitKeywords(form.keywords);
    config.instagram.publicReplyEnabled = form.publicReplyEnabled === "on";
    config.instagram.publicCommentReply = form.publicCommentReply;
    config.instagram.directMessage.text = form.directText;
    config.instagram.directMessage.buttonText = form.directButtonText;
    config.telegramTexts.welcome = form.tgWelcome;
    config.telegramTexts.notSubscribed = form.tgNotSubscribed;
    config.telegramTexts.subscribed = form.tgSubscribed;
    config.telegramTexts.checkButton = form.tgCheckButton;
    config.telegramTexts.channelButton = form.tgChannelButton;
    config.telegramTexts.landingButton = form.tgLandingButton;
    config.telegramMedia = config.telegramMedia || {};

    if (form.removeWelcomeImage === "on") {
      config.telegramMedia.welcomeImageId = "";
    }

    if (files.welcomeImage?.buffer?.length) {
      if (!files.welcomeImage.contentType?.startsWith("image/")) {
        return sendHtml(res, renderMessage("Можно загрузить только изображение", "/admin"), 400);
      }
      if (files.welcomeImage.buffer.length > 4 * 1024 * 1024) {
        return sendHtml(res, renderMessage("Картинка слишком большая. Максимум 4 MB", "/admin"), 400);
      }

      const imageId = await saveMediaFile({
        buffer: files.welcomeImage.buffer,
        filename: files.welcomeImage.filename,
        contentType: files.welcomeImage.contentType,
        metadata: { purpose: "telegram_welcome" }
      });
      if (imageId) config.telegramMedia.welcomeImageId = imageId;
    }

    await writeConfig(config);
    return sendHtml(res, renderMessage("Настройки сохранены", "/admin"));
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

async function handleMedia(url, res) {
  const id = url.pathname.replace("/media/", "").trim();
  const media = await getMediaFile(id);
  if (!media) return sendJson(res, 404, { error: "Media not found" });

  res.writeHead(200, {
    "content-type": media.file.contentType || "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable"
  });
  media.stream.pipe(res);
}

async function handleStats(url, res) {
  if (url.searchParams.get("password") !== adminPassword) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  if (!hasMongo()) {
    return sendJson(res, 200, {
      ok: false,
      error: "MONGODB_URI is not configured"
    });
  }

  const stats = await getStats();
  if (url.searchParams.get("format") === "json") {
    return sendJson(res, 200, { ok: true, stats });
  }

  return sendHtml(res, renderStats(stats, url.searchParams.get("password")));
}

function verifyMetaWebhook(url, res) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(challenge || "");
    return;
  }

  sendJson(res, 403, { error: "Meta webhook verification failed" });
}

function renderStats(stats, password) {
  const byType = Array.isArray(stats.byType) ? stats.byType : [];
  const maxCount = Math.max(1, ...byType.map((item) => item.count));
  const recentEvents = Array.isArray(stats.recentEvents) ? stats.recentEvents : [];
  const funnel = stats.funnel || {};

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stats | Instagram Telegram Gate</title>
  <style>
    :root {
      --ink: #10202f;
      --muted: #69788a;
      --glass: rgba(255,255,255,.6);
      --line: rgba(255,255,255,.66);
      --blue: #1d5fd6;
      --teal: #0f9f94;
      --coral: #d96b4b;
      --shadow: 0 22px 70px rgba(28, 48, 82, .18);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: linear-gradient(135deg, #eaf7f4 0%, #eef4ff 46%, #fff3ec 100%);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.5), rgba(255,255,255,0) 42%, rgba(255,255,255,.38)),
        repeating-linear-gradient(0deg, rgba(255,255,255,.14), rgba(255,255,255,.14) 1px, transparent 1px, transparent 18px);
    }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 48px; position: relative; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 44px); line-height: 1.04; letter-spacing: 0; }
    .subtitle { color: var(--muted); margin: 8px 0 0; }
    .nav { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .nav a {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.56);
      color: var(--ink);
      padding: 10px 14px;
      text-decoration: none;
      box-shadow: 0 8px 24px rgba(28,48,82,.08);
    }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
    .card, .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--glass);
      box-shadow: var(--shadow);
      backdrop-filter: blur(22px) saturate(150%);
      -webkit-backdrop-filter: blur(22px) saturate(150%);
    }
    .card { padding: 18px; min-height: 116px; }
    .label { color: var(--muted); font-size: 13px; font-weight: 700; }
    .value { margin-top: 12px; font-size: 34px; font-weight: 850; line-height: 1; }
    .accent-blue { color: var(--blue); }
    .accent-teal { color: var(--teal); }
    .accent-coral { color: var(--coral); }
    .layout { display: grid; grid-template-columns: 1.1fr .9fr; gap: 14px; }
    .panel { padding: 18px; }
    h2 { font-size: 16px; margin: 0 0 16px; letter-spacing: 0; }
    .funnel { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .step {
      border: 1px solid rgba(255,255,255,.62);
      border-radius: 8px;
      background: rgba(255,255,255,.42);
      padding: 14px;
    }
    .step strong { display: block; font-size: 24px; margin-top: 8px; }
    .bar-row { display: grid; grid-template-columns: minmax(160px, 1fr) 3fr 48px; align-items: center; gap: 12px; margin: 12px 0; }
    .bar-label { color: var(--ink); overflow-wrap: anywhere; font-size: 13px; }
    .bar-track { height: 10px; border-radius: 8px; background: rgba(255,255,255,.52); overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--blue), var(--teal)); }
    .bar-count { text-align: right; font-weight: 800; color: var(--muted); }
    .events { display: grid; gap: 10px; }
    .event {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      padding: 11px 0;
      border-top: 1px solid rgba(255,255,255,.58);
    }
    .event:first-child { border-top: 0; }
    .event-type { font-weight: 800; overflow-wrap: anywhere; }
    .event-time { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .event-meta { color: var(--muted); font-size: 12px; grid-column: 1 / -1; overflow-wrap: anywhere; }
    @media (max-width: 900px) {
      main { width: min(100% - 20px, 1120px); padding-top: 16px; }
      .topbar { display: block; }
      .nav { justify-content: flex-start; margin-top: 14px; }
      .grid, .layout, .funnel { grid-template-columns: 1fr; }
      .bar-row { grid-template-columns: 1fr; gap: 6px; }
      .bar-count { text-align: left; }
    }
  </style>
</head>
<body>
<main>
  <div class="topbar">
    <div>
      <h1>Stats</h1>
      <p class="subtitle">Живая картина по Instagram, Telegram и воронке доступа.</p>
    </div>
    <nav class="nav">
      <a href="/admin">Admin</a>
      <a href="/stats?password=${encodeURIComponent(password || "")}&format=json">JSON</a>
    </nav>
  </div>

  <section class="grid">
    ${metricCard("Всего событий", stats.totalEvents, "accent-blue")}
    ${metricCard("За 24 часа", stats.events24h, "accent-teal")}
    ${metricCard("Telegram users", stats.users, "accent-coral")}
    ${metricCard("Instagram recipients", stats.instagramRecipients, "accent-blue")}
  </section>

  <section class="panel" style="margin-bottom:14px">
    <h2>Воронка</h2>
    <div class="funnel">
      ${funnelStep("Комментарии", funnel.comments)}
      ${funnelStep("Ответы Meta", funnel.repliesSent)}
      ${funnelStep("Telegram start", funnel.telegramStarts)}
      ${funnelStep("Проверки подписки", funnel.subscriptionChecks)}
    </div>
  </section>

  <div class="layout">
    <section class="panel">
      <h2>События по типам</h2>
      ${byType.length ? byType.map((item) => eventBar(item, maxCount)).join("") : `<p class="subtitle">Пока нет событий.</p>`}
    </section>
    <section class="panel">
      <h2>Последние события</h2>
      <div class="events">
        ${recentEvents.length ? recentEvents.map(renderEvent).join("") : `<p class="subtitle">Пока нет последних событий.</p>`}
      </div>
    </section>
  </div>
</main>
</body>
</html>`;
}

function metricCard(label, value, accentClass) {
  return `<div class="card"><div class="label">${esc(label)}</div><div class="value ${accentClass}">${Number(value || 0)}</div></div>`;
}

function funnelStep(label, value) {
  return `<div class="step"><span class="label">${esc(label)}</span><strong>${Number(value || 0)}</strong></div>`;
}

function eventBar(item, maxCount) {
  const width = Math.max(4, Math.round((item.count / maxCount) * 100));
  return `<div class="bar-row">
    <div class="bar-label">${esc(eventTitle(item.type))}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
    <div class="bar-count">${Number(item.count || 0)}</div>
  </div>`;
}

function renderEvent(event) {
  const details = [
    event.label ? actionTitle(event.label) : "",
    event.status ? `Статус: ${event.status}` : "",
    event.subscribed === undefined ? "" : (event.subscribed ? "Подписка подтверждена" : "Подписки нет"),
    event.commentId ? `Комментарий: ${event.commentId}` : "",
    event.telegramId ? `Telegram ID: ${event.telegramId}` : "",
    event.instagramUserId ? `Instagram ID: ${event.instagramUserId}` : ""
  ]
    .filter((item) => item !== undefined && item !== null && item !== "")
    .join(" · ");
  return `<div class="event">
    <div class="event-type">${esc(eventTitle(event.type))}</div>
    <div class="event-time">${esc(formatDate(event.createdAt))}</div>
    ${details ? `<div class="event-meta">${esc(details)}</div>` : ""}
  </div>`;
}

function eventTitle(type) {
  const titles = {
    meta_webhook_received: "Webhook от Instagram получен",
    instagram_comment_received: "Новый комментарий в Instagram",
    instagram_comment_reply_skipped: "Ответ на комментарий пропущен",
    instagram_comment_duplicate_skipped: "Дубликат комментария пропущен",
    instagram_direct_message_received: "Сообщение в Instagram Direct",
    instagram_recipient_duplicate_skipped: "Пользователь уже получал сообщение",
    meta_api_sent: "Ответ отправлен через Meta",
    meta_api_failed: "Ошибка отправки через Meta",
    meta_api_skipped: "Meta-запрос пропущен",
    telegram_update_received: "Событие от Telegram получено",
    telegram_started: "Пользователь открыл Telegram-бота",
    telegram_subscription_checked: "Проверка подписки в Telegram"
  };
  return titles[type] || type;
}

function actionTitle(label) {
  const titles = {
    "private reply": "Direct-ответ на комментарий",
    "public comment reply": "Публичный ответ под комментарием",
    "direct message": "Ответ в Direct",
    "Meta API request": "Запрос к Meta"
  };
  return titles[label] || label;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderAdmin(config) {
  const keywords = Array.isArray(config.instagram.keywords) ? config.instagram.keywords.join(", ") : "";
  const welcomeImageId = config.telegramMedia?.welcomeImageId || "";
  const welcomeImageUrl = welcomeImageId ? `/media/${welcomeImageId}` : "";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Instagram Telegram Gate</title>
  <style>
    :root {
      --ink: #10202f;
      --muted: #657487;
      --line: rgba(255,255,255,.56);
      --glass: rgba(255,255,255,.58);
      --glass-strong: rgba(255,255,255,.76);
      --blue: #1d5fd6;
      --teal: #0f9f94;
      --coral: #d96b4b;
      --shadow: 0 22px 70px rgba(28, 48, 82, .18);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background:
        linear-gradient(135deg, #eaf7f4 0%, #eef4ff 42%, #fff3ec 100%);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.48), rgba(255,255,255,0) 38%, rgba(255,255,255,.36)),
        repeating-linear-gradient(0deg, rgba(255,255,255,.13), rgba(255,255,255,.13) 1px, transparent 1px, transparent 18px);
    }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 46px; position: relative; }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    h1 { margin: 0; font-size: clamp(26px, 4vw, 42px); line-height: 1.04; letter-spacing: 0; }
    .subtitle { margin: 8px 0 0; color: var(--muted); max-width: 660px; }
    .nav { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .nav a, button {
      border: 1px solid rgba(255,255,255,.68);
      border-radius: 8px;
      background: rgba(255,255,255,.55);
      color: var(--ink);
      box-shadow: 0 8px 24px rgba(28,48,82,.08);
      text-decoration: none;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }
    form {
      border: 1px solid rgba(255,255,255,.72);
      border-radius: 8px;
      background: var(--glass);
      box-shadow: var(--shadow);
      backdrop-filter: blur(22px) saturate(150%);
      -webkit-backdrop-filter: blur(22px) saturate(150%);
      overflow: hidden;
    }
    .section { padding: 22px; border-top: 1px solid rgba(255,255,255,.58); }
    .section:first-child { border-top: 0; }
    h2 { font-size: 16px; margin: 0 0 16px; letter-spacing: 0; }
    .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .field { min-width: 0; }
    label { display: block; font-weight: 700; font-size: 13px; margin: 0 0 7px; }
    input[type="text"], input[type="password"], textarea {
      width: 100%;
      border: 1px solid rgba(42, 74, 104, .18);
      border-radius: 8px;
      background: rgba(255,255,255,.68);
      color: var(--ink);
      padding: 11px 12px;
      font: inherit;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
    }
    input:focus, textarea:focus { border-color: rgba(29,95,214,.55); box-shadow: 0 0 0 3px rgba(29,95,214,.13); }
    textarea { min-height: 104px; resize: vertical; }
    small { color: var(--muted); display: block; margin-top: 6px; }
    .toggles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.64);
      background: rgba(255,255,255,.45);
      font-weight: 700;
    }
    .toggle input { inline-size: 42px; block-size: 23px; accent-color: var(--teal); }
    .actions {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
      padding: 18px 22px 22px;
      border-top: 1px solid rgba(255,255,255,.58);
    }
    .save {
      background: linear-gradient(135deg, var(--blue), var(--teal));
      color: white;
      border-color: rgba(255,255,255,.5);
      font-weight: 800;
      min-width: 170px;
    }
    .hint { color: var(--muted); font-size: 13px; }
    @media (max-width: 860px) {
      .topbar { display: block; }
      .nav { justify-content: flex-start; margin-top: 14px; }
      .row, .toggles { grid-template-columns: 1fr; }
      main { width: min(100% - 20px, 1120px); padding-top: 16px; }
      .actions { display: block; }
      .save { width: 100%; margin-top: 12px; }
    }
  </style>
</head>
<body>
<main>
  <div class="topbar">
    <div>
      <h1>Instagram Telegram Gate</h1>
      <p class="subtitle">Панель сценария: комментарий или Direct в Instagram, переход в Telegram, проверка подписки и выдача лендинга.</p>
    </div>
    <nav class="nav">
      <a data-auth-link="/stats?password=" href="/stats?password=">Stats</a>
      <a data-auth-link="/telegram/webhook-info?password=" href="/telegram/webhook-info?password=">Telegram webhook</a>
    </nav>
  </div>
  <form method="post" action="/admin" enctype="multipart/form-data">
    <section class="section">
      <h2>Доступ</h2>
      <div class="row">
        <div class="field">
          <label>Пароль админки</label>
          <input id="adminPassword" name="password" type="password" required>
        </div>
        <div class="field">
          <label>Ссылка на лендинг</label>
          <input name="landingUrl" type="text" value="${esc(config.landingUrl)}">
        </div>
        <div class="field">
          <label>Ключевые слова</label>
          <input name="keywords" type="text" value="${esc(keywords)}">
          <small>Пусто = реагировать на все комментарии.</small>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Telegram</h2>
      <div class="row">
        <div class="field">
          <label>Канал для проверки</label>
          <input name="channelUsername" type="text" value="${esc(config.telegram.channelUsername)}">
        </div>
        <div class="field">
          <label>Start payload</label>
          <input name="startPayload" type="text" value="${esc(config.telegram.startPayload)}">
        </div>
        <div class="field">
          <label>Кнопка лендинга</label>
          <input name="tgLandingButton" type="text" value="${esc(config.telegramTexts.landingButton)}">
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Триггеры Instagram</h2>
      <div class="toggles">
        <label class="toggle">Комментарии <input name="comments" type="checkbox" ${checked(config.instagram.enabledTriggers.comments)}></label>
        <label class="toggle">Direct <input name="directMessages" type="checkbox" ${checked(config.instagram.enabledTriggers.directMessages)}></label>
        <label class="toggle">Share/Repost <input name="shares" type="checkbox" ${checked(config.instagram.enabledTriggers.shares)}></label>
        <label class="toggle">Публичный ответ <input name="publicReplyEnabled" type="checkbox" ${checked(config.instagram.publicReplyEnabled === true)}></label>
      </div>
    </section>

    <section class="section">
      <h2>Instagram сообщения</h2>
      <div class="row">
        <div class="field">
          <label>Текст Direct</label>
          <textarea name="directText">${esc(config.instagram.directMessage.text)}</textarea>
        </div>
        <div class="field">
          <label>Текст кнопки в Instagram</label>
          <input name="directButtonText" type="text" value="${esc(config.instagram.directMessage.buttonText)}">
          <small>Кнопка ведет в Telegram-бота.</small>
        </div>
        <div class="field">
          <label>Публичный ответ на комментарий</label>
          <input name="publicCommentReply" type="text" value="${esc(config.instagram.publicCommentReply)}">
          <small>Лучше держать выключенным, чтобы не плодить ответы.</small>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Telegram тексты</h2>
      <div class="row">
        <div class="field">
          <label>Приветствие</label>
          <textarea name="tgWelcome">${esc(config.telegramTexts.welcome)}</textarea>
          <small>Можно отправлять как текст или как подпись к картинке.</small>
        </div>
        <div class="field">
          <label>Если не подписан</label>
          <textarea name="tgNotSubscribed">${esc(config.telegramTexts.notSubscribed)}</textarea>
        </div>
        <div class="field">
          <label>Если подписан</label>
          <textarea name="tgSubscribed">${esc(config.telegramTexts.subscribed)}</textarea>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>Картинка приветствия</label>
          <input name="welcomeImage" type="file" accept="image/*">
          <small>Хранится в MongoDB GridFS. Максимум 4 MB.</small>
        </div>
        <div class="field">
          <label>Текущая картинка</label>
          ${welcomeImageUrl ? `<img src="${esc(welcomeImageUrl)}" alt="Welcome image" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.7)">` : `<div class="hint">Картинка не загружена.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить картинку <input name="removeWelcomeImage" type="checkbox"></label>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>Кнопка проверки</label>
          <input name="tgCheckButton" type="text" value="${esc(config.telegramTexts.checkButton)}">
        </div>
        <div class="field">
          <label>Кнопка канала</label>
          <input name="tgChannelButton" type="text" value="${esc(config.telegramTexts.channelButton)}">
        </div>
        <div class="field">
          <label>Кнопка лендинга</label>
          <input name="tgLandingButton" type="text" value="${esc(config.telegramTexts.landingButton)}">
        </div>
      </div>
    </section>

    <div class="actions">
      <div class="hint">Настройки сохраняются в MongoDB Atlas, если MONGODB_URI настроен в Vercel.</div>
      <button class="save" type="submit">Сохранить</button>
    </div>
  </form>
</main>
<script>
  const passwordInput = document.getElementById("adminPassword");
  const authLinks = Array.from(document.querySelectorAll("[data-auth-link]"));
  function syncAuthLinks() {
    const value = encodeURIComponent(passwordInput.value || "");
    for (const link of authLinks) link.href = link.dataset.authLink + value;
  }
  passwordInput.addEventListener("input", syncAuthLinks);
  syncAuthLinks();
</script>
</body>
</html>`;
}

function renderMessage(message, href) {
  return `<!doctype html><meta charset="utf-8"><p>${esc(message)}</p><p><a href="${href}">Назад</a></p>`;
}

function renderLegalPage(title, content) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; line-height: 1.6; color: #17202a; background: #f7f9fb; }
    main { max-width: 860px; margin: 0 auto; padding: 36px 18px 56px; }
    article { background: #fff; border: 1px solid #d9e0e7; border-radius: 8px; padding: 26px; }
    h1 { font-size: 28px; line-height: 1.2; margin: 0 0 16px; }
    h2 { font-size: 18px; margin: 26px 0 8px; }
    p { margin: 10px 0; }
    ul { padding-left: 22px; }
    a { color: #175cd3; }
  </style>
</head>
<body>
<main>
  <article>
    ${content}
  </article>
</main>
</body>
</html>`;
}

function renderPrivacyPolicy() {
  return renderLegalPage("Политика конфиденциальности", `
    <h1>Политика конфиденциальности</h1>
    <p>Дата обновления: 13 октября 2026 г.</p>
    <p>Этот сервис помогает пользователям Instagram перейти в Telegram-бота, проверить подписку на Telegram-канал и получить ссылку на лендинг.</p>

    <h2>Какие данные обрабатываются</h2>
    <p>Сервис может получать технические данные из Instagram Webhooks, включая идентификаторы комментариев, сообщений, отправителей и текст комментария или сообщения, если это необходимо для работы автоматического ответа.</p>
    <p>Telegram-бот может получать Telegram ID пользователя, имя пользователя, статус подписки на канал и сообщения, отправленные боту.</p>

    <h2>Для чего используются данные</h2>
    <ul>
      <li>для отправки автоматического ответа в Instagram;</li>
      <li>для перехода пользователя в Telegram-бота;</li>
      <li>для проверки подписки на Telegram-канал;</li>
      <li>для выдачи ссылки на лендинг после успешной проверки.</li>
    </ul>

    <h2>Передача данных</h2>
    <p>Данные не продаются третьим лицам. Для работы сервиса используются платформы Meta/Instagram, Telegram и хостинг Vercel.</p>

    <h2>Хранение данных</h2>
    <p>В текущей MVP-версии сервис не использует постоянную базу данных для хранения пользователей. Технические логи могут временно храниться в инфраструктуре хостинга.</p>

    <h2>Удаление данных</h2>
    <p>Пользователь может прекратить использование сервиса, удалив диалог с ботом или заблокировав бота. Для запроса удаления данных свяжитесь с владельцем сервиса через Telegram-бота или контакт, указанный на лендинге.</p>

    <h2>Контакты</h2>
    <p>По вопросам конфиденциальности свяжитесь с владельцем сервиса через сайт <a href="https://www.partners.tatti-app.win">partners.tatti-app.win</a>.</p>
  `);
}

function renderTerms() {
  return renderLegalPage("Пользовательское соглашение", `
    <h1>Пользовательское соглашение</h1>
    <p>Дата обновления: 13 октября 2026 г.</p>
    <p>Используя этот сервис, пользователь соглашается с условиями ниже.</p>

    <h2>Описание сервиса</h2>
    <p>Сервис автоматизирует ответы на действия в Instagram, направляет пользователя в Telegram-бота, проверяет подписку на Telegram-канал и предоставляет ссылку на лендинг.</p>

    <h2>Условия использования</h2>
    <ul>
      <li>пользователь должен соблюдать правила Instagram, Telegram и применимое законодательство;</li>
      <li>сервис может быть временно недоступен из-за ограничений API, хостинга или платформ;</li>
      <li>доступ к лендингу может зависеть от подписки на указанный Telegram-канал.</li>
    </ul>

    <h2>Ограничение ответственности</h2>
    <p>Сервис предоставляется как есть. Владелец не гарантирует бесперебойную работу Instagram API, Telegram API или стороннего хостинга.</p>

    <h2>Изменения условий</h2>
    <p>Условия могут обновляться. Новая версия вступает в силу после публикации на этой странице.</p>

    <h2>Контакты</h2>
    <p>По вопросам использования сервиса свяжитесь с владельцем через сайт <a href="https://www.partners.tatti-app.win">partners.tatti-app.win</a>.</p>
  `);
}

function splitKeywords(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function checked(value) {
  return value ? "checked" : "";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readJson(req) {
  const text = await readText(req);
  return text ? JSON.parse(text) : {};
}

async function readForm(req) {
  const text = await readText(req);
  return Object.fromEntries(new URLSearchParams(text));
}

async function readFormData(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      fields: await readForm(req),
      files: {}
    };
  }

  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: 4 * 1024 * 1024,
        files: 4,
        fields: 80
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => reject(new Error("Uploaded file is too large")));
      file.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 0) {
          files[name] = {
            buffer,
            filename: info.filename,
            contentType: info.mimeType
          };
        }
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));
    req.pipe(busboy);
  });
}

function readText(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
