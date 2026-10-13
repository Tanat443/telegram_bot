import http from "node:http";
import { URL } from "node:url";
import { getEnv, loadDotEnv, normalizeUrl, readConfig, requireEnv, writeConfig } from "./config.js";
import { MetaClient } from "./meta.js";
import { TelegramBot } from "./telegram.js";

await loadDotEnv();

const port = Number(getEnv("PORT", "3000"));
const adminPassword = getEnv("ADMIN_PASSWORD", "admin");
const verifyToken = getEnv("META_VERIFY_TOKEN", "verify-token");

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

telegram.startPolling();

function isMetaWebhookPath(pathname) {
  return pathname === "/webhooks/meta" || pathname === "/api/webhooks/meta";
}

async function handleAdmin(req, res) {
  if (req.method === "GET") {
    const config = await readConfig();
    return sendHtml(res, renderAdmin(config));
  }

  if (req.method === "POST") {
    const form = await readForm(req);
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
    config.instagram.publicCommentReply = form.publicCommentReply;
    config.instagram.directMessage.text = form.directText;
    config.instagram.directMessage.buttonText = form.directButtonText;
    config.telegramTexts.welcome = form.tgWelcome;
    config.telegramTexts.notSubscribed = form.tgNotSubscribed;
    config.telegramTexts.subscribed = form.tgSubscribed;
    config.telegramTexts.checkButton = form.tgCheckButton;
    config.telegramTexts.channelButton = form.tgChannelButton;
    config.telegramTexts.landingButton = form.tgLandingButton;

    await writeConfig(config);
    return sendHtml(res, renderMessage("Настройки сохранены", "/admin"));
  }

  return sendJson(res, 405, { error: "Method not allowed" });
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

function renderAdmin(config) {
  const keywords = Array.isArray(config.instagram.keywords) ? config.instagram.keywords.join(", ") : "";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Instagram Telegram Gate</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f6f8; color: #17202a; }
    main { max-width: 920px; margin: 32px auto; padding: 0 16px 40px; }
    h1 { font-size: 26px; margin: 0 0 18px; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    form { background: white; border: 1px solid #d9e0e7; border-radius: 8px; padding: 20px; }
    label { display: block; font-weight: 700; margin: 14px 0 6px; }
    input[type="text"], input[type="password"], textarea { width: 100%; box-sizing: border-box; border: 1px solid #b9c4d0; border-radius: 6px; padding: 10px; font: inherit; }
    textarea { min-height: 92px; resize: vertical; }
    .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .check { display: flex; gap: 8px; align-items: center; font-weight: 400; margin-top: 8px; }
    button { margin-top: 22px; border: 0; border-radius: 6px; background: #175cd3; color: white; padding: 11px 16px; font: inherit; cursor: pointer; }
    small { color: #5f6f7f; }
    @media (max-width: 720px) { .row { grid-template-columns: 1fr; } main { margin-top: 18px; } }
  </style>
</head>
<body>
<main>
  <h1>Instagram Telegram Gate</h1>
  <form method="post" action="/admin">
    <label>Пароль админки</label>
    <input name="password" type="password" required>

    <h2>Основное</h2>
    <label>Ссылка на лендинг</label>
    <input name="landingUrl" type="text" value="${esc(config.landingUrl)}">

    <div class="row">
      <div>
        <label>Telegram канал</label>
        <input name="channelUsername" type="text" value="${esc(config.telegram.channelUsername)}">
      </div>
      <div>
        <label>Start payload</label>
        <input name="startPayload" type="text" value="${esc(config.telegram.startPayload)}">
      </div>
      <div>
        <label>Ключевые слова</label>
        <input name="keywords" type="text" value="${esc(keywords)}">
        <small>Пусто = реагировать на все</small>
      </div>
    </div>

    <h2>Триггеры Instagram</h2>
    <label class="check"><input name="comments" type="checkbox" ${checked(config.instagram.enabledTriggers.comments)}> Комментарии</label>
    <label class="check"><input name="directMessages" type="checkbox" ${checked(config.instagram.enabledTriggers.directMessages)}> Сообщения в Direct</label>
    <label class="check"><input name="shares" type="checkbox" ${checked(config.instagram.enabledTriggers.shares)}> Share/repost в Direct</label>

    <label>Публичный ответ на комментарий</label>
    <input name="publicCommentReply" type="text" value="${esc(config.instagram.publicCommentReply)}">

    <label>Текст Instagram Direct</label>
    <textarea name="directText">${esc(config.instagram.directMessage.text)}</textarea>

    <label>Текст кнопки в Instagram</label>
    <input name="directButtonText" type="text" value="${esc(config.instagram.directMessage.buttonText)}">

    <h2>Тексты Telegram</h2>
    <label>Приветствие</label>
    <textarea name="tgWelcome">${esc(config.telegramTexts.welcome)}</textarea>

    <label>Если не подписан</label>
    <textarea name="tgNotSubscribed">${esc(config.telegramTexts.notSubscribed)}</textarea>

    <label>Если подписан</label>
    <textarea name="tgSubscribed">${esc(config.telegramTexts.subscribed)}</textarea>

    <div class="row">
      <div>
        <label>Кнопка проверки</label>
        <input name="tgCheckButton" type="text" value="${esc(config.telegramTexts.checkButton)}">
      </div>
      <div>
        <label>Кнопка канала</label>
        <input name="tgChannelButton" type="text" value="${esc(config.telegramTexts.channelButton)}">
      </div>
      <div>
        <label>Кнопка лендинга</label>
        <input name="tgLandingButton" type="text" value="${esc(config.telegramTexts.landingButton)}">
      </div>
    </div>

    <button type="submit">Сохранить</button>
  </form>
</main>
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
