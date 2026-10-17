import http from "node:http";
import crypto from "node:crypto";
import Busboy from "busboy";
import sharp from "sharp";
import { URL } from "node:url";
import { getEnv, loadDotEnv, normalizeUrl, readCampaigns, readConfig, readConfigForCampaignId, writeConfig } from "./config.js";
import { clearStats, getMediaFile, getStats, hasMongo, listInstagramMedia, listMediaFiles, recordEvent, saveConsultationLead, saveMediaFile, upsertInstagramMedia } from "./db.js";
import { renderLessonPage } from "./lesson.js";
import { MetaClient } from "./meta.js";
import { TelegramBot } from "./telegram.js";

await loadDotEnv();

const port = Number(getEnv("PORT", "3000"));
const adminPassword = getEnv("ADMIN_PASSWORD", "admin");
const adminSessionSecret = getEnv("ADMIN_SESSION_SECRET", adminPassword);
const verifyToken = getEnv("META_VERIFY_TOKEN", "verify-token");
const telegramWebhookSecret = getEnv("TELEGRAM_WEBHOOK_SECRET");
const telegramToken = getEnv("TELEGRAM_BOT_TOKEN");
const MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 1.2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const MAX_ADMIN_UPLOAD_FIELDS = 10;

const telegram = new TelegramBot({
  token: telegramToken,
  configProvider: readConfig,
  botUsername: getEnv("TELEGRAM_BOT_USERNAME")
});

try {
  await telegram.init();
} catch (error) {
  console.error(`Telegram init skipped: ${error.message}`);
}

const meta = new MetaClient({
  accessToken: getEnv("META_ACCESS_TOKEN"),
  apiVersion: getEnv("META_API_VERSION", "v24.0"),
  graphBaseUrl: getEnv("META_GRAPH_BASE_URL", "https://graph.instagram.com"),
  publicBaseUrl: normalizeUrl(getEnv("PUBLIC_BASE_URL")),
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

    if (req.method === "GET" && url.pathname === "/lesson") {
      return sendHtml(res, renderLessonPage({
        videoUrl: getEnv("LESSON_VIDEO_URL"),
        posterUrl: getEnv("LESSON_VIDEO_POSTER_URL"),
        sent: url.searchParams.get("sent") === "1"
      }));
    }

    if (req.method === "POST" && url.pathname === "/lesson/consultation") {
      return handleLessonConsultation(req, res);
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

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "instagram-telegram-gate",
        env: {
          hasTelegramToken: Boolean(getEnv("TELEGRAM_BOT_TOKEN")),
          hasTelegramUsername: Boolean(getEnv("TELEGRAM_BOT_USERNAME")),
          hasMetaToken: Boolean(getEnv("META_ACCESS_TOKEN")),
          hasMongoUri: Boolean(getEnv("MONGODB_URI")),
          publicBaseUrl: getEnv("PUBLIC_BASE_URL") || ""
        }
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/r/")) {
      return handleLandingRedirect(req, res, url);
    }

    if (url.pathname === "/admin/login") {
      return handleAdminLogin(req, res, url);
    }

    if (url.pathname === "/admin/logout") {
      return handleAdminLogout(req, res);
    }

    if (url.pathname === "/admin") {
      return handleAdmin(req, res);
    }

    if (url.pathname === "/admin/campaigns") {
      return handleCampaignList(req, res);
    }

    if (url.pathname === "/admin/campaigns/new") {
      return handleCampaignEditor(req, res, null);
    }

    if (url.pathname.startsWith("/admin/campaigns/") && url.pathname.endsWith("/delete")) {
      const campaignId = url.pathname.slice("/admin/campaigns/".length, -"/delete".length);
      return handleCampaignDelete(req, res, decodeURIComponent(campaignId));
    }

    if (url.pathname.startsWith("/admin/campaigns/")) {
      return handleCampaignEditor(req, res, decodeURIComponent(url.pathname.replace("/admin/campaigns/", "")));
    }

    if (url.pathname === "/admin/posts") {
      return handleAdminPosts(req, res);
    }

    if (url.pathname === "/admin/media") {
      return handleAdminMedia(req, res);
    }

    if (req.method === "GET" && url.pathname === "/admin/media-debug") {
      return handleMediaDebug(req, res);
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      return handleStats(req, url, res);
    }

    if (url.pathname === "/stats/clear") {
      return handleClearStats(req, res);
    }

    if (req.method === "GET" && url.pathname === "/telegram/set-webhook") {
      return setTelegramWebhook(url, req, res);
    }

    if (req.method === "GET" && url.pathname === "/telegram/webhook-info") {
      return getTelegramWebhookInfo(req, res);
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

async function handleLessonConsultation(req, res) {
  const form = await readForm(req);
  if (form.website) {
    res.writeHead(303, { location: "/lesson?sent=1" });
    res.end();
    return;
  }

  const values = {
    name: String(form.name || "").trim().slice(0, 80),
    contact: String(form.contact || "").trim().slice(0, 24),
    experience: String(form.experience || "").trim().slice(0, 40),
    goal: String(form.goal || "").trim().slice(0, 40)
  };
  const allowedExperience = new Set(["none", "account", "tried", "portfolio"]);
  const allowedGoals = new Set(["capital", "halal", "income", "manage"]);
  let error = "";
  if (!values.name || !values.contact || !allowedExperience.has(values.experience) || !allowedGoals.has(values.goal)) {
    error = "Барлық міндетті жолды толтыр.";
  } else if (!hasMongo()) {
    error = "Өтінімді сақтау қызметі уақытша қолжетімсіз. Кейінірек қайталап көр.";
  }

  if (error) {
    return sendHtml(res, renderLessonPage({
      videoUrl: getEnv("LESSON_VIDEO_URL"),
      posterUrl: getEnv("LESSON_VIDEO_POSTER_URL"),
      error,
      values
    }), 400);
  }

  const leadId = await saveConsultationLead(values);
  await recordEvent("lesson_consultation_submitted", { leadId });
  res.writeHead(303, { location: "/lesson?sent=1" });
  res.end();
}

function shouldUseTelegramPolling() {
  const explicit = getEnv("TELEGRAM_USE_POLLING");
  if (explicit) return explicit === "true";
  return getEnv("VERCEL") !== "1";
}

async function setTelegramWebhook(url, req, res) {
  if (!requireAdmin(req, res, "/telegram/set-webhook")) return;

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

async function getTelegramWebhookInfo(req, res) {
  if (!requireAdmin(req, res, "/telegram/webhook-info")) return;

  const info = await telegram.api("getWebhookInfo");
  return sendJson(res, 200, { ok: true, info });
}

async function handleAdminLogin(req, res, url) {
  if (req.method === "GET") {
    return sendHtml(res, renderLogin(url.searchParams.get("next") || "/admin"));
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const form = await readForm(req);
  const next = safeNextPath(form.next || "/admin");
  if (!timingSafeEqual(form.password || "", adminPassword)) {
    return sendHtml(res, renderLogin(next, "Неверный пароль"), 401);
  }

  res.writeHead(302, {
    location: next,
    "set-cookie": adminSessionCookie()
  });
  res.end();
}

function handleAdminLogout(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  res.writeHead(302, {
    location: "/admin/login",
    "set-cookie": clearAdminSessionCookie()
  });
  res.end();
}

function requireAdmin(req, res, redirectTo = "") {
  if (isAdminAuthenticated(req)) return true;

  const next = redirectTo || req.url || "/admin";
  res.writeHead(302, { location: `/admin/login?next=${encodeURIComponent(safeNextPath(next))}` });
  res.end();
  return false;
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.admin_session || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!timingSafeEqual(signSessionPayload(payload), signature)) return false;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  return data?.role === "admin" && Number(data.exp || 0) > Date.now();
}

function adminSessionCookie() {
  const payload = Buffer.from(JSON.stringify({
    role: "admin",
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");
  const token = `${payload}.${signSessionPayload(payload)}`;
  return serializeCookie("admin_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });
}

function clearAdminSessionCookie() {
  return serializeCookie("admin_session", "", {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 0
  });
}

function signSessionPayload(payload) {
  return crypto
    .createHmac("sha256", adminSessionSecret || "admin-session")
    .update(payload)
    .digest("base64url");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge || 0))}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function isSecureCookie() {
  return getEnv("VERCEL") === "1" || normalizeUrl(getEnv("PUBLIC_BASE_URL")).startsWith("https://");
}

function safeNextPath(value) {
  const path = String(value || "/admin");
  if (!path.startsWith("/") || path.startsWith("//")) return "/admin";
  return path;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function handleAdmin(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    res.writeHead(302, { location: "/admin/campaigns" });
    res.end();
    return;
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

async function handleCampaignList(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

  const config = await readConfig();
  return sendHtml(res, renderCampaignList(config));
}

async function handleCampaignEditor(req, res, campaignId) {
  if (!requireAdmin(req, res)) return;
  const config = await readConfig();
  const campaigns = adminCampaigns(config);
  const campaign = campaignId ? campaigns.find((item) => String(item._id || item.id) === campaignId) : null;

  if (req.method === "GET") {
    if (campaignId && !campaign) {
      return sendHtml(res, renderMessage("Автоматизация не найдена", "/admin/campaigns"), 404);
    }
    const posts = hasMongo() ? await listInstagramMedia() : [];
    const mediaFiles = hasMongo() ? await listMediaFiles() : [];
    return sendHtml(res, renderCampaignEditor(config, campaign || defaultAdminCampaign(config), Boolean(campaignId), posts, mediaFiles, campaigns));
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const form = await readForm(req);
  const nextCampaign = normalizeCampaignForm(form, config, campaigns.length);
  const enabledTriggers = nextCampaign.instagram?.enabledTriggers || {};
  if (!enabledTriggers.comments && !enabledTriggers.directMessages && !enabledTriggers.shares) {
    return sendHtml(res, renderMessage("Выберите хотя бы одно событие для запуска автоматизации.", campaignId ? `/admin/campaigns/${encodeURIComponent(campaignId)}` : "/admin/campaigns/new"), 400);
  }
  const nextCampaigns = campaigns.filter((item) => String(item._id || item.id) !== nextCampaign._id);
  nextCampaigns.push(nextCampaign);
  config.campaigns = nextCampaigns.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  await writeConfig(config);
  return sendHtml(res, renderMessage("Автоматизация сохранена", `/admin/campaigns/${encodeURIComponent(nextCampaign._id)}`));
}

async function handleCampaignDelete(req, res, campaignId) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const config = await readConfig();
  const campaigns = adminCampaigns(config);
  const remaining = campaigns.filter((item) => String(item._id || item.id) !== campaignId);
  if (remaining.length === campaigns.length) {
    return sendHtml(res, renderMessage("Автоматизация не найдена", "/admin/campaigns"), 404);
  }

  config.campaigns = remaining;
  await writeConfig(config);
  return sendHtml(res, renderMessage("Автоматизация удалена", "/admin/campaigns"));
}

async function handleAdminMedia(req, res) {
  if (!requireAdmin(req, res)) return;
  const config = await readConfig();

  if (req.method === "GET") {
    const files = hasMongo() ? await listMediaFiles() : [];
    return sendHtml(res, renderMediaLibrary(config, files, hasMongo()));
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const { fields: form, files, errors } = await readFormData(req);
  if (errors.length) {
    return sendHtml(res, renderMessage(errors.join("<br>"), "/admin/media"), 400);
  }
  try {
    const file = files.mediaFile;
    if (!file?.buffer?.length) {
      return sendHtml(res, renderMessage("Выберите файл для загрузки", "/admin/media"), 400);
    }
    const expectedPrefix = file.contentType?.startsWith("video/") ? "video/" : "image/";
    await saveUploadedMedia(file, form.purpose || "media_library", expectedPrefix);
  } catch (error) {
    return sendHtml(res, renderMessage(error.message, "/admin/media"), 400);
  }

  return sendHtml(res, renderMessage("Файл загружен", "/admin/media"));
}

async function handleAdminPosts(req, res) {
  if (!requireAdmin(req, res)) return;
  const config = await readConfig();

  if (req.method === "GET") {
    const posts = hasMongo() ? await listInstagramMedia() : [];
    return sendHtml(res, renderInstagramPosts(config, posts, hasMongo()));
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const form = await readForm(req);
  if (!hasMongo()) {
    return sendHtml(res, renderMessage("MONGODB_URI не настроен", "/admin/posts"), 400);
  }

  try {
    const items = await meta.fetchMediaList(50);
    const saved = await upsertInstagramMedia(items);
    return sendHtml(res, renderMessage(`Посты синхронизированы: ${saved}`, "/admin/posts"));
  } catch (error) {
    return sendHtml(res, renderMessage(error.message, "/admin/posts"), 400);
  }
}

async function saveUploadedMedia(file, purpose, expectedPrefix) {
  if (!file.contentType?.startsWith(expectedPrefix)) {
    throw new Error(expectedPrefix === "image/" ? "Можно загрузить только изображение" : "Можно загрузить только видео");
  }

  const media = expectedPrefix === "image/"
    ? await normalizeImageUpload(file)
    : normalizeVideoUpload(file);

  const mediaId = await saveMediaFile({
    buffer: media.buffer,
    filename: media.filename,
    contentType: media.contentType,
    metadata: {
      purpose,
      ...media.metadata
    }
  });
  if (!mediaId) {
    throw new Error("Файл не сохранился в MongoDB. Проверьте MONGODB_URI в Vercel.");
  }

  console.log(`Media uploaded: purpose=${purpose}; id=${mediaId}; filename=${media.filename}; type=${media.contentType}; size=${media.buffer.length}; original=${file.filename}:${file.contentType}:${file.buffer.length}`);
  return mediaId;
}

async function normalizeImageUpload(file) {
  if (file.buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error(`Картинка слишком большая. Максимум ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)}.`);
  }

  let pipeline = sharp(file.buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: MAX_IMAGE_SIDE,
      height: MAX_IMAGE_SIDE,
      fit: "inside",
      withoutEnlargement: true
    });

  const inputMetadata = await pipeline.metadata();
  const attempts = [82, 76, 70, 64, 58, 52];
  let output = null;
  let quality = attempts[attempts.length - 1];

  for (const attempt of attempts) {
    const buffer = await pipeline
      .clone()
      .jpeg({ quality: attempt, progressive: true, mozjpeg: true })
      .toBuffer();
    output = buffer;
    quality = attempt;
    if (buffer.length <= TARGET_IMAGE_BYTES) break;
  }

  const outputMetadata = await sharp(output).metadata();
  const baseName = String(file.filename || "image").replace(/\.[^.]+$/, "");
  return {
    buffer: output,
    filename: `${safeFilenameBase(baseName)}.jpg`,
    contentType: "image/jpeg",
    metadata: {
      normalized: true,
      originalFilename: file.filename || "",
      originalContentType: file.contentType || "",
      originalSize: file.buffer.length,
      originalWidth: inputMetadata.width || null,
      originalHeight: inputMetadata.height || null,
      width: outputMetadata.width || null,
      height: outputMetadata.height || null,
      quality,
      targetBytes: TARGET_IMAGE_BYTES
    }
  };
}

function normalizeVideoUpload(file) {
  if (file.buffer.length > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`Видео слишком большое. Максимум ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}.`);
  }

  return {
    buffer: file.buffer,
    filename: file.filename || "video",
    contentType: file.contentType,
    metadata: {
      normalized: false,
      originalFilename: file.filename || "",
      originalContentType: file.contentType || "",
      originalSize: file.buffer.length
    }
  };
}

function safeFilenameBase(value) {
  return String(value || "image")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}
async function handleMediaDebug(req, res) {
  if (!requireAdmin(req, res, "/admin/media-debug")) return;

  const config = await readConfig();
  return sendJson(res, 200, {
    ok: true,
    instagramDirectImageId: config.instagram?.directMedia?.imageId || "",
    telegramMedia: {
      welcomeImageId: config.telegramMedia?.welcomeImageId || "",
      welcomePhoto1Id: config.telegramMedia?.welcomePhoto1Id || "",
      welcomeCircleVideoId: config.telegramMedia?.welcomeCircleVideoId || "",
      welcomePhoto2Id: config.telegramMedia?.welcomePhoto2Id || "",
      subscribedPhotoId: config.telegramMedia?.subscribedPhotoId || ""
    }
  });
}

async function handleMedia(url, res) {
  const id = url.pathname.replace("/media/", "").trim();
  const media = await getMediaFile(id);
  if (!media) return sendJson(res, 404, { error: "Media not found" });

  if (url.searchParams.get("info") === "1") {
    return sendJson(res, 200, {
      ok: true,
      id,
      filename: media.file.filename,
      contentType: mediaContentType(media.file),
      length: media.file.length,
      uploadDate: media.file.uploadDate,
      metadata: media.file.metadata || {}
    });
  }

  res.writeHead(200, {
    "content-type": mediaContentType(media.file),
    "content-length": media.file.length,
    "content-disposition": `inline; filename="${safeHeaderFilename(media.file.filename || "media")}"`,
    "cache-control": "public, max-age=31536000, immutable"
  });
  media.stream.on("error", (error) => {
    console.error(`Media stream failed: ${error.message}`);
    if (!res.headersSent) sendJson(res, 500, { error: "Media stream failed" });
    else res.destroy(error);
  });
  media.stream.pipe(res);
}

function mediaContentType(file) {
  const declaredType = String(
    file.contentType
      || file.metadata?.contentType
      || file.metadata?.originalContentType
      || ""
  ).trim().toLowerCase();

  if (declaredType && declaredType !== "application/octet-stream") {
    return declaredType;
  }

  return inferContentType(file.filename) || declaredType || "application/octet-stream";
}

function inferContentType(filename = "") {
  const ext = filename.toLowerCase().split(".").pop();
  const types = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm"
  };
  return types[ext] || "";
}

function safeHeaderFilename(filename) {
  return String(filename).replaceAll(/["\r\n]/g, "_");
}

async function handleStats(req, url, res) {
  if (!requireAdmin(req, res, `${url.pathname}${url.search}`)) return;

  if (!hasMongo()) {
    return sendJson(res, 200, {
      ok: false,
      error: "MONGODB_URI is not configured"
    });
  }

  const filters = statsFilters(url.searchParams);
  const [stats, config, media] = await Promise.all([
    getStats(filters),
    readConfig(),
    listInstagramMedia(200)
  ]);
  const campaigns = await readCampaigns(config);
  const mediaOptions = [...media];
  const knownMediaIds = new Set(mediaOptions.map((item) => String(item.id)));
  for (const campaign of campaigns) {
    for (const mediaId of campaign.mediaIds || []) {
      if (knownMediaIds.has(String(mediaId))) continue;
      knownMediaIds.add(String(mediaId));
      mediaOptions.push({ id: String(mediaId), mediaType: "Campaign media", caption: "" });
    }
  }
  if (url.searchParams.get("format") === "json") {
    return sendJson(res, 200, { ok: true, filters, stats });
  }

  return sendHtml(res, renderStats(stats, filters, { campaigns, media: mediaOptions }));
}

async function handleClearStats(req, res) {
  if (!requireAdmin(req, res, "/stats")) return;
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (!hasMongo()) return sendHtml(res, renderMessage("MONGODB_URI не настроен", "/stats"), 400);

  const form = await readForm(req);
  if (form.confirm !== "clear-stats") {
    return sendHtml(res, renderMessage("Очистка статистики не подтверждена", "/stats"), 400);
  }

  const params = new URLSearchParams();
  for (const name of ["campaign", "media", "from", "to", "type"]) {
    if (form[name]) params.set(name, form[name]);
  }
  const filters = statsFilters(params);
  const deletedCount = await clearStats(filters);
  return sendHtml(res, renderMessage(`Удалено событий: ${deletedCount}`, "/stats"));
}

async function handleLandingRedirect(req, res, url) {
  const rawCampaignId = url.pathname.slice(3);
  let campaignId;
  try {
    campaignId = decodeURIComponent(rawCampaignId);
  } catch {
    return sendJson(res, 400, { error: "Invalid campaign id" });
  }
  if (!campaignId || campaignId.includes("/")) return sendJson(res, 404, { error: "Campaign not found" });

  const config = await readConfigForCampaignId(campaignId);
  if (campaignId !== "default" && config.campaign?.id !== campaignId) {
    return sendJson(res, 404, { error: "Campaign not found" });
  }

  const landingUrl = normalizeUrl(config.landingUrl);
  if (!/^https?:\/\//i.test(landingUrl)) return sendJson(res, 404, { error: "Landing URL is not configured" });

  const telegramId = String(url.searchParams.get("tg") || "").trim();
  await recordEvent("landing_clicked", {
    campaignId: config.campaign?.id || campaignId,
    campaignName: config.campaign?.name || campaignId,
    telegramId,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    referer: String(req.headers.referer || "").slice(0, 1000)
  });

  res.writeHead(302, { location: landingUrl, "cache-control": "no-store" });
  res.end();
}

function statsFilters(searchParams) {
  const dateFrom = parseStatsDate(searchParams.get("from"), false);
  const dateTo = parseStatsDate(searchParams.get("to"), true);
  return {
    campaignId: cleanFilter(searchParams.get("campaign")),
    mediaId: cleanFilter(searchParams.get("media")),
    eventType: cleanFilter(searchParams.get("type")),
    dateFrom,
    dateTo,
    dateFromInput: cleanFilter(searchParams.get("from")),
    dateToInput: cleanFilter(searchParams.get("to"))
  };
}

function cleanFilter(value) {
  return String(value || "").trim().slice(0, 200);
}

function parseStatsDate(value, endOfDay) {
  const normalized = cleanFilter(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
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

function renderStats(stats, filters = {}, options = {}) {
  const byType = Array.isArray(stats.byType) ? stats.byType : [];
  const maxCount = Math.max(1, ...byType.map((item) => item.count));
  const recentEvents = Array.isArray(stats.recentEvents) ? stats.recentEvents : [];
  const metrics = stats.metrics || stats.funnel || {};
  const byCampaign = Array.isArray(stats.byCampaign) ? stats.byCampaign : [];
  const campaigns = Array.isArray(options.campaigns) ? options.campaigns : [];
  const media = Array.isArray(options.media) ? options.media : [];
  const eventTypes = Array.isArray(stats.availableEventTypes) ? stats.availableEventTypes : [];
  const jsonQuery = statsFilterQuery(filters, { format: "json" });

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
    .filters { display: grid; grid-template-columns: 1.2fr 1.4fr repeat(3, minmax(130px, .8fr)) auto; gap: 10px; align-items: end; margin-bottom: 14px; }
    .field label { display: block; color: var(--muted); font-size: 12px; font-weight: 800; margin-bottom: 6px; }
    .field select, .field input { width: 100%; border: 1px solid rgba(42,74,104,.18); border-radius: 8px; background: rgba(255,255,255,.72); color: var(--ink); padding: 10px; font: inherit; }
    .button { border: 0; border-radius: 8px; background: linear-gradient(135deg, var(--blue), var(--teal)); color: white; padding: 11px 16px; font: inherit; font-weight: 800; cursor: pointer; }
    .button.danger { background: linear-gradient(135deg, #b83232, #d96b4b); }
    .reset { display: inline-block; color: var(--muted); font-size: 13px; padding: 10px 0; }
    .clear-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 14px; }
    .clear-row form { margin: 0; }
    .funnel { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
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
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: right; padding: 10px 9px; border-top: 1px solid rgba(255,255,255,.58); white-space: nowrap; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    th:first-child, td:first-child { text-align: left; }
    tbody a { color: var(--blue); font-weight: 800; text-decoration: none; }
    @media (max-width: 900px) {
      main { width: min(100% - 20px, 1120px); padding-top: 16px; }
      .topbar { display: block; }
      .nav { justify-content: flex-start; margin-top: 14px; }
      .grid, .layout, .funnel, .filters { grid-template-columns: 1fr; }
      .clear-row { display: grid; }
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
      <p class="subtitle">Статистика по кампаниям и сквозной воронке Instagram → Telegram → landing.</p>
    </div>
    <nav class="nav">
      <a href="/admin">Admin</a>
      <a href="/stats?${esc(jsonQuery)}">JSON</a>
      <a href="/admin/logout">Logout</a>
    </nav>
  </div>

  <form class="panel filters" method="get" action="/stats">
    <div class="field">
      <label>Кампания</label>
      <select name="campaign">
        <option value="">Все кампании</option>
        ${campaigns.map((campaign) => selectOption(campaign.id, campaign.name, filters.campaignId)).join("")}
      </select>
    </div>
    <div class="field">
      <label>Post / media</label>
      <select name="media">
        <option value="">Все публикации</option>
        ${media.map((item) => selectOption(item.id, statsMediaOptionLabel(item), filters.mediaId)).join("")}
      </select>
    </div>
    <div class="field">
      <label>С даты</label>
      <input type="date" name="from" value="${esc(filters.dateFromInput || "")}">
    </div>
    <div class="field">
      <label>По дату</label>
      <input type="date" name="to" value="${esc(filters.dateToInput || "")}">
    </div>
    <div class="field">
      <label>Тип события</label>
      <select name="type">
        <option value="">Все события</option>
        ${eventTypes.map((type) => selectOption(type, eventTitle(type), filters.eventType)).join("")}
      </select>
    </div>
    <button class="button" type="submit">Применить</button>
    <a class="reset" href="/stats">Сбросить фильтры</a>
  </form>

  <section class="panel clear-row">
    <div>
      <h2 style="margin-bottom:5px">Очистка статистики</h2>
      <div class="subtitle">Удалит события по текущим фильтрам. Без фильтров удалит всю статистику событий.</div>
    </div>
    <form method="post" action="/stats/clear" onsubmit="return confirm('Удалить статистику по текущим фильтрам? Это действие нельзя отменить.')">
      <input type="hidden" name="confirm" value="clear-stats">
      ${statsFilterHiddenInputs(filters)}
      <button class="button danger" type="submit">Очистить статистику</button>
    </form>
  </section>

  <section class="grid">
    ${metricCard("Всего событий", stats.totalEvents, "accent-blue")}
    ${metricCard("За 24 часа", stats.events24h, "accent-teal")}
    ${metricCard("Telegram users", stats.users, "accent-coral")}
    ${metricCard("IG recipients", stats.instagramRecipients, "accent-blue")}
  </section>

  <section class="panel" style="margin-bottom:14px">
    <h2>Метрики кампании</h2>
    <div class="funnel">
      ${funnelStep("Комментарии", metrics.comments)}
      ${funnelStep("IG replies", metrics.repliesSent)}
      ${funnelStep("Ошибки Meta", metrics.metaErrors)}
      ${funnelStep("Telegram starts", metrics.telegramStarts)}
      ${funnelStep("Подписался", metrics.subscribed)}
      ${funnelStep("Не подписался", metrics.notSubscribed)}
      ${funnelStep("Landing clicks", metrics.landingClicks)}
    </div>
  </section>

  <section class="panel" style="margin-bottom:14px">
    <h2>Кампании</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Кампания</th><th>Комментарии</th><th>IG replies</th><th>Meta errors</th><th>TG starts</th><th>Подписался</th><th>Не подписался</th><th>Landing</th></tr></thead>
        <tbody>
          ${byCampaign.length ? byCampaign.map((item) => renderCampaignStatsRow(item, filters)).join("") : `<tr><td colspan="8">Нет событий по выбранным фильтрам.</td></tr>`}
        </tbody>
      </table>
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

function selectOption(value, label, selected) {
  return `<option value="${esc(value)}"${String(value) === String(selected || "") ? " selected" : ""}>${esc(label || value)}</option>`;
}

function statsMediaOptionLabel(item) {
  const caption = String(item.caption || "").replace(/\s+/g, " ").trim();
  return caption ? `${caption.slice(0, 70)} · ${item.id}` : `${item.mediaType || "Media"} · ${item.id}`;
}

function statsFilterQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  if (filters.campaignId) params.set("campaign", filters.campaignId);
  if (filters.mediaId) params.set("media", filters.mediaId);
  if (filters.dateFromInput) params.set("from", filters.dateFromInput);
  if (filters.dateToInput) params.set("to", filters.dateToInput);
  if (filters.eventType) params.set("type", filters.eventType);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

function statsFilterHiddenInputs(filters) {
  const values = {
    campaign: filters.campaignId,
    media: filters.mediaId,
    from: filters.dateFromInput,
    to: filters.dateToInput,
    type: filters.eventType
  };
  return Object.entries(values)
    .filter(([, value]) => value)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${esc(value)}">`)
    .join("");
}

function renderCampaignStatsRow(item, filters) {
  const query = statsFilterQuery({ ...filters, campaignId: item.campaignId });
  return `<tr>
    <td><a href="/stats?${esc(query)}">${esc(item.campaignName || item.campaignId)}</a></td>
    <td>${Number(item.comments || 0)}</td>
    <td>${Number(item.repliesSent || 0)}</td>
    <td>${Number(item.metaErrors || 0)}</td>
    <td>${Number(item.telegramStarts || 0)}</td>
    <td>${Number(item.subscribed || 0)}</td>
    <td>${Number(item.notSubscribed || 0)}</td>
    <td>${Number(item.landingClicks || 0)}</td>
  </tr>`;
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
    event.campaignName || event.campaignId ? `Кампания: ${event.campaignName || event.campaignId}` : "",
    event.mediaId ? `Media: ${event.mediaId}` : "",
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

function renderLogin(next = "/admin", error = "") {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #10202f;
      background: linear-gradient(135deg, #eaf7f4 0%, #eef4ff 42%, #fff3ec 100%);
    }
    form {
      width: min(420px, calc(100% - 32px));
      border: 1px solid rgba(255,255,255,.72);
      border-radius: 8px;
      background: rgba(255,255,255,.62);
      box-shadow: 0 22px 70px rgba(28, 48, 82, .18);
      backdrop-filter: blur(22px) saturate(150%);
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    p { margin: 0 0 18px; color: #657487; }
    label { display: block; font-weight: 800; font-size: 13px; margin-bottom: 7px; }
    input { width: 100%; border: 1px solid rgba(42, 74, 104, .18); border-radius: 8px; background: rgba(255,255,255,.75); padding: 12px; font: inherit; }
    button { width: 100%; margin-top: 14px; border: 1px solid rgba(255,255,255,.68); border-radius: 8px; background: linear-gradient(135deg, #1d5fd6, #0f9f94); color: white; font: inherit; font-weight: 800; padding: 12px 14px; cursor: pointer; }
    .error { color: #9b2c2c; margin-bottom: 12px; font-weight: 800; }
  </style>
</head>
<body>
  <form method="post" action="/admin/login">
    <h1>Admin login</h1>
    <p>Войдите один раз, дальше админка будет работать через защищенную cookie-сессию.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <input type="hidden" name="next" value="${esc(safeNextPath(next))}">
    <label>Пароль</label>
    <input name="password" type="password" autofocus required>
    <button type="submit">Войти</button>
  </form>
</body>
</html>`;
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
    telegram_subscription_checked: "Проверка подписки в Telegram",
    telegram_welcome_image_failed: "Картинка приветствия не отправилась",
    telegram_welcome_video_failed: "Кружок Telegram не отправился",
    telegram_photo_failed: "Фото Telegram не отправилось",
    telegram_photo_sent: "Фото Telegram отправлено",
    telegram_subscribed_response_started: "Ответ после подписки начат",
    landing_clicked: "Переход на landing"
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mediaPreview(url, alt) {
  return `<img src="${esc(url)}" alt="${esc(alt)}" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.7)">`;
}

function videoPreview(url) {
  return `<video src="${esc(url)}" controls muted style="width:100%;max-height:180px;border-radius:8px;border:1px solid rgba(255,255,255,.7)"></video>`;
}

function mediaAdminUrl(mediaId) {
  return `/media/${encodeURIComponent(mediaId)}?v=${encodeURIComponent(mediaId)}`;
}

function parseCampaignsForm(value, config) {
  if (!String(value || "").trim()) return Array.isArray(config.campaigns) ? config.campaigns : [];

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Не удалось прочитать автоматизации. Обновите страницу и попробуйте снова.");
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((campaign, index) => normalizeAdminCampaign(campaign, config, index))
    .filter(Boolean);
}

function normalizeCampaignForm(form, config, index = 0) {
  return normalizeAdminCampaign({
    _id: form.id,
    name: form.name,
    status: form.status,
    priority: form.priority,
    mediaIds: form.mediaIds,
    keywords: form.keywords,
    landingUrl: form.landingUrl,
    inheritDefaults: {
      landing: form.landingMode !== "custom",
      instagramMessage: form.instagramMessageMode !== "custom",
      telegramFlow: form.telegramMode !== "custom"
    },
    instagram: {
      enabledTriggers: {
        comments: form.comments === "on",
        directMessages: form.directMessages === "on",
        shares: form.shares === "on"
      },
      publicReplyEnabled: form.publicReplyEnabled === "on",
      publicCommentReply: form.publicCommentReply,
      directMessage: {
        text: form.directText,
        buttonText: form.directButtonText
      },
      directMedia: {
        imageId: form.directImageId
      }
    },
    telegram: {
      channelUsername: form.channelUsername,
      startPayload: form.startPayload
    },
    telegramTexts: {
      welcome: form.tgWelcome,
      notSubscribed: form.tgNotSubscribed,
      subscribed: form.tgSubscribed
    },
    telegramMedia: {
      welcomePhoto1Id: form.welcomePhoto1Id,
      welcomeCircleVideoId: form.welcomeCircleVideoId,
      welcomePhoto2Id: form.welcomePhoto2Id,
      subscribedPhotoId: form.subscribedPhotoId
    }
  }, config, index);
}

function normalizeAdminCampaign(campaign, config, index) {
  const name = String(campaign?.name || "").trim();
  const id = slugify(campaign?._id || campaign?.id || name || `automation-${index + 1}`);
  if (!id && !name) return null;

  const telegram = campaign?.telegram || {};
  const instagram = campaign?.instagram || {};
  const directMessage = instagram.directMessage || {};
  const inheritDefaults = campaign?.inheritDefaults || {};
  const useDefaultLanding = Boolean(inheritDefaults.landing);
  const useDefaultInstagramMessage = Boolean(inheritDefaults.instagramMessage);
  const useDefaultTelegramFlow = Boolean(inheritDefaults.telegramFlow);

  return {
    _id: id,
    name: name || id,
    status: campaign?.status === "paused" ? "paused" : "active",
    priority: Number(campaign?.priority || 0),
    mediaIds: splitLines(campaign?.mediaIds),
    keywords: splitKeywords(Array.isArray(campaign?.keywords) ? campaign.keywords.join(",") : campaign?.keywords),
    inheritDefaults: {
      landing: useDefaultLanding,
      instagramMessage: useDefaultInstagramMessage,
      telegramFlow: useDefaultTelegramFlow
    },
    landingUrl: normalizeUrl(useDefaultLanding ? config.landingUrl : campaign?.landingUrl || config.landingUrl),
    instagram: {
      enabledTriggers: {
        comments: Boolean(instagram.enabledTriggers?.comments),
        directMessages: Boolean(instagram.enabledTriggers?.directMessages),
        shares: Boolean(instagram.enabledTriggers?.shares)
      },
      publicReplyEnabled: useDefaultInstagramMessage ? Boolean(config.instagram?.publicReplyEnabled) : Boolean(instagram.publicReplyEnabled),
      publicCommentReply: String(useDefaultInstagramMessage ? config.instagram?.publicCommentReply || "" : instagram.publicCommentReply || config.instagram?.publicCommentReply || ""),
      directMessage: {
        text: String(useDefaultInstagramMessage ? config.instagram?.directMessage?.text || "" : directMessage.text || config.instagram?.directMessage?.text || ""),
        buttonText: String(useDefaultInstagramMessage ? config.instagram?.directMessage?.buttonText || "" : directMessage.buttonText || config.instagram?.directMessage?.buttonText || "")
      },
      directMedia: {
        imageId: String(useDefaultInstagramMessage ? config.instagram?.directMedia?.imageId || "" : instagram.directMedia?.imageId || "")
      }
    },
    telegram: {
      channelUsername: String(useDefaultTelegramFlow ? config.telegram?.channelUsername || "" : telegram.channelUsername || config.telegram?.channelUsername || ""),
      startPayload: slugify(telegram.startPayload || `camp-${id}`).replaceAll("-", "_")
    },
    telegramTexts: {
      welcome: String(useDefaultTelegramFlow ? config.telegramTexts?.welcome || "" : campaign?.telegramTexts?.welcome || config.telegramTexts?.welcome || ""),
      notSubscribed: String(useDefaultTelegramFlow ? config.telegramTexts?.notSubscribed || "" : campaign?.telegramTexts?.notSubscribed || config.telegramTexts?.notSubscribed || ""),
      subscribed: String(useDefaultTelegramFlow ? config.telegramTexts?.subscribed || "" : campaign?.telegramTexts?.subscribed || config.telegramTexts?.subscribed || "")
    },
    telegramMedia: {
      welcomePhoto1Id: String(useDefaultTelegramFlow ? config.telegramMedia?.welcomePhoto1Id || config.telegramMedia?.welcomeImageId || "" : campaign?.telegramMedia?.welcomePhoto1Id || ""),
      welcomeCircleVideoId: String(useDefaultTelegramFlow ? config.telegramMedia?.welcomeCircleVideoId || "" : campaign?.telegramMedia?.welcomeCircleVideoId || ""),
      welcomePhoto2Id: String(useDefaultTelegramFlow ? config.telegramMedia?.welcomePhoto2Id || "" : campaign?.telegramMedia?.welcomePhoto2Id || ""),
      subscribedPhotoId: String(useDefaultTelegramFlow ? config.telegramMedia?.subscribedPhotoId || "" : campaign?.telegramMedia?.subscribedPhotoId || "")
    },
    updatedAt: new Date().toISOString()
  };
}

function defaultAdminCampaign(config) {
  const nextPriority = adminCampaigns(config).reduce((max, campaign) => Math.max(max, Number(campaign.priority || 0)), 0) + 10;
  const campaign = normalizeAdminCampaign({
    _id: "",
    name: "",
    status: "active",
    priority: nextPriority,
    mediaIds: [],
    keywords: config.instagram?.keywords || [],
    landingUrl: config.landingUrl,
    instagram: config.instagram || {},
    telegram: {
      channelUsername: config.telegram?.channelUsername || "",
      startPayload: ""
    },
    telegramTexts: config.telegramTexts || {},
    telegramMedia: {},
    inheritDefaults: {
      landing: true,
      instagramMessage: true,
      telegramFlow: true
    }
  }, config, adminCampaigns(config).length);
  return {
    ...campaign,
    _id: "",
    telegram: {
      ...campaign.telegram,
      startPayload: ""
    }
  };
}

function adminCampaigns(config) {
  return Array.isArray(config.campaigns) ? config.campaigns : [];
}

function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderAdminShell(title, config, content) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Instagram Telegram Gate</title>
  <style>
    :root {
      --ink: #10202f;
      --muted: #657487;
      --line: rgba(255,255,255,.62);
      --glass: rgba(255,255,255,.62);
      --glass-strong: rgba(255,255,255,.78);
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
      background: linear-gradient(135deg, #eaf7f4 0%, #eef4ff 42%, #fff3ec 100%);
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
    main { width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 46px; position: relative; }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(26px, 4vw, 42px); line-height: 1.04; letter-spacing: 0; }
    h2 { margin: 0 0 16px; font-size: 16px; letter-spacing: 0; }
    .subtitle { margin: 8px 0 0; color: var(--muted); max-width: 680px; }
    .nav { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .nav a, .button, button {
      border: 1px solid rgba(255,255,255,.68);
      border-radius: 8px;
      background: rgba(255,255,255,.55);
      color: var(--ink);
      box-shadow: 0 8px 24px rgba(28,48,82,.08);
      text-decoration: none;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
    }
    .button.primary, button.primary { background: linear-gradient(135deg, var(--blue), var(--teal)); color: white; font-weight: 800; }
    .button.danger, button.danger { background: linear-gradient(135deg, #b83232, var(--coral)); color: white; font-weight: 800; }
    .panel, .card {
      border: 1px solid rgba(255,255,255,.72);
      border-radius: 8px;
      background: var(--glass);
      box-shadow: var(--shadow);
      backdrop-filter: blur(22px) saturate(150%);
      -webkit-backdrop-filter: blur(22px) saturate(150%);
    }
    .panel { padding: 22px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .stack { display: grid; gap: 14px; }
    .card { padding: 18px; }
    .card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .muted, small { color: var(--muted); }
    .pill { border-radius: 8px; padding: 6px 9px; font-size: 12px; font-weight: 800; background: rgba(255,255,255,.58); border: 1px solid var(--line); }
    .pill.active { color: #08645d; }
    .pill.paused { color: #93431f; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    form { display: grid; gap: 14px; }
    .section { padding: 22px; border: 1px solid rgba(255,255,255,.72); border-radius: 8px; background: var(--glass); box-shadow: var(--shadow); }
    .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .field { min-width: 0; }
    label { display: block; font-weight: 800; font-size: 13px; margin: 0 0 7px; }
    input[type="text"], input[type="password"], input[type="number"], textarea, select {
      width: 100%;
      border: 1px solid rgba(42, 74, 104, .18);
      border-radius: 8px;
      background: rgba(255,255,255,.7);
      color: var(--ink);
      padding: 11px 12px;
      font: inherit;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
    }
    input:focus, textarea:focus, select:focus { border-color: rgba(29,95,214,.55); box-shadow: 0 0 0 3px rgba(29,95,214,.13); }
    textarea { min-height: 104px; resize: vertical; }
    .toggles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.64); background: rgba(255,255,255,.45); font-weight: 800; }
    .toggle input { inline-size: 42px; block-size: 23px; accent-color: var(--teal); }
    .post-picker { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .post-option { display: grid; grid-template-columns: auto 64px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 82px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.64); background: rgba(255,255,255,.45); margin: 0; }
    .post-option input { accent-color: var(--teal); }
    .post-thumb { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; border: 1px solid rgba(255,255,255,.72); background: rgba(255,255,255,.5); display: grid; place-items: center; color: var(--muted); font-size: 11px; text-align: center; }
    .post-option strong, .post-option small { display: block; overflow-wrap: anywhere; }
    .actions { display: flex; justify-content: space-between; gap: 14px; align-items: center; }
    @media (max-width: 900px) {
      main { width: min(100% - 20px, 1160px); padding-top: 16px; }
      .topbar { display: block; }
      .nav { justify-content: flex-start; margin-top: 14px; }
      .grid, .row, .toggles, .post-picker { grid-template-columns: 1fr; }
      .actions { display: grid; }
    }
  </style>
</head>
<body>
<main>
  <div class="topbar">
    <div>
      <h1>${esc(title)}</h1>
      <p class="subtitle">Автоматизации используют один Telegram bot, а нужный сценарий выбирается через start payload.</p>
    </div>
    <nav class="nav">
      <a href="/admin/campaigns">Автоматизации</a>
      <a href="/admin/posts">Posts</a>
      <a href="/admin/media">Media</a>
      <a href="/stats">Stats</a>
      <a href="/telegram/webhook-info">Webhook</a>
      <a href="/admin/logout">Logout</a>
    </nav>
  </div>
  ${content}
</main>
</body>
</html>`;
}

function renderCampaignList(config) {
  const campaigns = adminCampaigns(config);
  const content = `
    <div class="actions" style="margin-bottom:14px">
      <div class="muted">${campaigns.length ? `Создано автоматизаций: ${campaigns.length}` : "Пока нет автоматизаций."}</div>
      <a class="button primary" href="/admin/campaigns/new">Создать автоматизацию</a>
    </div>
    <section class="grid">
      ${campaigns.length ? campaigns.map(renderCampaignCard).join("") : renderEmptyCampaignCard()}
    </section>`;
  return renderAdminShell("Автоматизации", config, content);
}

function renderCampaignCard(campaign) {
  const triggers = campaign.instagram?.enabledTriggers || {};
  const mediaCount = Array.isArray(campaign.mediaIds) ? campaign.mediaIds.length : 0;
  const keywordCount = Array.isArray(campaign.keywords) ? campaign.keywords.length : 0;
  const status = campaign.status === "paused" ? "paused" : "active";
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>${esc(campaign.name || campaign._id)}</h2>
          <div class="muted">${esc(campaign._id || "")}</div>
        </div>
        <span class="pill ${status}">${status === "active" ? "Active" : "Paused"}</span>
      </div>
      <div class="meta">
        <span class="pill">${mediaCount ? `${mediaCount} post/Reels` : "Any post"}</span>
        <span class="pill">${keywordCount ? `${keywordCount} keywords` : "Any keyword"}</span>
        ${triggers.comments ? `<span class="pill">Comments</span>` : ""}
        ${triggers.directMessages ? `<span class="pill">Direct</span>` : ""}
        ${triggers.shares ? `<span class="pill">Share</span>` : ""}
      </div>
      <p class="muted">Payload: <strong>${esc(campaign.telegram?.startPayload || "")}</strong></p>
      <div class="meta">
        <a class="button" href="/admin/campaigns/${encodeURIComponent(campaign._id || campaign.id)}">Редактировать</a>
        <form method="post" action="/admin/campaigns/${encodeURIComponent(campaign._id || campaign.id)}/delete" onsubmit="return confirm('Удалить эту автоматизацию? Это действие нельзя отменить.')">
          <button class="danger" type="submit">Удалить</button>
        </form>
      </div>
    </article>`;
}

function renderEmptyCampaignCard() {
  return `
    <article class="card">
      <h2>Создайте первую автоматизацию</h2>
      <p class="muted">Привяжите posts/Reels, keywords, Telegram payload и landing URL в одной кампании.</p>
      <a class="button primary" href="/admin/campaigns/new">Создать первую</a>
    </article>`;
}

function renderCampaignEditor(config, campaign, existing, posts = [], mediaFiles = [], campaigns = []) {
  const triggers = campaign.instagram?.enabledTriggers || {};
  const directMessage = campaign.instagram?.directMessage || {};
  const selectedMediaIds = new Set((campaign.mediaIds || []).map(String));
  const inheritDefaults = campaign.inheritDefaults || {};
  const landingMode = inheritDefaults.landing ? "default" : "custom";
  const instagramMessageMode = inheritDefaults.instagramMessage ? "default" : "custom";
  const telegramMode = inheritDefaults.telegramFlow ? "default" : "custom";
  const conflictCampaigns = campaigns
    .filter((item) => String(item._id || item.id) !== String(campaign._id || campaign.id))
    .map((item) => ({
      id: item._id || item.id,
      name: item.name || item._id || item.id,
      priority: Number(item.priority || 0),
      mediaIds: item.mediaIds || [],
      keywords: item.keywords || [],
      triggers: item.instagram?.enabledTriggers || {}
    }));
  const content = `
    <style>
      .wizard-shell { position: relative; }
      .wizard-ambient { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: -1; }
      .wizard-ambient::before, .wizard-ambient::after { content: ""; position: absolute; width: 38vw; height: 38vw; border-radius: 50%; filter: blur(55px); opacity: .34; }
      .wizard-ambient::before { top: 8%; left: -10%; background: #76d7cc; }
      .wizard-ambient::after { right: -10%; bottom: 4%; background: #9dbdff; }
      .wizard-progress { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; padding: 10px; margin-bottom: 16px; border: 1px solid rgba(255,255,255,.78); border-radius: 24px; background: rgba(255,255,255,.46); box-shadow: 0 20px 60px rgba(31,55,88,.12); backdrop-filter: blur(30px) saturate(165%); }
      .wizard-progress button { min-height: 62px; padding: 9px 10px; border: 0; border-radius: 17px; box-shadow: none; background: transparent; justify-content: flex-start; gap: 9px; color: var(--muted); text-align: left; }
      .wizard-progress button[aria-current="step"] { color: var(--ink); background: rgba(255,255,255,.78); box-shadow: 0 10px 28px rgba(31,55,88,.1), inset 0 1px 0 #fff; }
      .wizard-progress button.is-done { color: #08776d; }
      .step-number { flex: 0 0 30px; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.65); font-weight: 900; }
      .wizard-progress button[aria-current="step"] .step-number { color: white; background: linear-gradient(135deg, var(--blue), var(--teal)); }
      .step-label { font-size: 12px; font-weight: 850; line-height: 1.15; }
      .wizard-step { display: none; min-height: 490px; padding: clamp(22px, 4vw, 42px); border: 1px solid rgba(255,255,255,.82); border-radius: 30px; background: linear-gradient(145deg, rgba(255,255,255,.72), rgba(255,255,255,.46)); box-shadow: 0 28px 90px rgba(29,53,87,.16), inset 0 1px 0 rgba(255,255,255,.94); backdrop-filter: blur(34px) saturate(170%); overflow: hidden; }
      .wizard-step.is-active { display: block; animation: stepIn .32s ease both; }
      @keyframes stepIn { from { opacity: 0; transform: translateY(8px) scale(.995); } to { opacity: 1; transform: none; } }
      .step-kicker { margin: 0 0 8px; color: var(--teal); font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      .wizard-step h2 { max-width: 760px; margin: 0; font-size: clamp(25px, 4vw, 40px); line-height: 1.06; letter-spacing: -.035em; }
      .step-copy { max-width: 720px; margin: 12px 0 26px; color: var(--muted); font-size: 16px; line-height: 1.55; }
      .choice-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
      .choice-grid.two { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .choice-card { position: relative; display: block; min-height: 142px; margin: 0; padding: 18px; border: 1px solid rgba(255,255,255,.78); border-radius: 22px; background: rgba(255,255,255,.46); box-shadow: inset 0 1px 0 rgba(255,255,255,.9); cursor: pointer; transition: .2s ease; }
      .choice-card:hover { transform: translateY(-2px); background: rgba(255,255,255,.63); }
      .choice-card:has(input:checked) { border-color: rgba(15,159,148,.46); background: linear-gradient(145deg, rgba(255,255,255,.82), rgba(211,248,241,.68)); box-shadow: 0 15px 42px rgba(15,159,148,.12), inset 0 1px 0 #fff; }
      .choice-card input { position: absolute; top: 18px; right: 18px; width: 20px; height: 20px; accent-color: var(--teal); }
      .choice-card strong { display: block; max-width: calc(100% - 34px); margin-bottom: 7px; font-size: 16px; }
      .choice-card small { display: block; line-height: 1.45; font-weight: 500; }
      .field-card { padding: 18px; border: 1px solid rgba(255,255,255,.75); border-radius: 22px; background: rgba(255,255,255,.44); }
      .field-card + .field-card, .mode-details, .scope-box { margin-top: 14px; }
      .mode-details { padding: 18px; border-radius: 22px; background: rgba(255,255,255,.4); border: 1px solid rgba(255,255,255,.72); }
      .mode-details.is-hidden, .conditional.is-hidden { display: none; }
      .scope-box { padding: 16px; border-radius: 20px; border: 1px solid rgba(255,255,255,.72); background: rgba(255,255,255,.36); }
      .scope-head { display: flex; justify-content: space-between; gap: 14px; align-items: center; margin-bottom: 12px; }
      .segmented { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(32,58,84,.07); }
      .segmented label { position: relative; margin: 0; padding: 8px 11px; border-radius: 11px; cursor: pointer; }
      .segmented label:has(input:checked) { background: rgba(255,255,255,.86); box-shadow: 0 5px 16px rgba(31,55,88,.1); color: var(--ink); }
      .segmented input { position: absolute; opacity: 0; pointer-events: none; }
      .advanced { margin-top: 14px; }
      .advanced summary { cursor: pointer; color: var(--muted); font-weight: 800; }
      .advanced textarea { margin-top: 10px; }
      .wizard-footer { position: sticky; bottom: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; padding: 12px; border: 1px solid rgba(255,255,255,.82); border-radius: 22px; background: rgba(244,249,252,.74); box-shadow: 0 18px 50px rgba(29,53,87,.16); backdrop-filter: blur(26px) saturate(160%); z-index: 5; }
      .wizard-footer .button, .wizard-footer button { border-radius: 15px; min-width: 118px; }
      .footer-right { display: flex; gap: 9px; margin-left: auto; }
      .error-banner { display: none; margin-bottom: 14px; padding: 12px 15px; border-radius: 15px; color: #8a2d23; background: rgba(255,224,217,.78); border: 1px solid rgba(190,75,56,.24); }
      .error-banner.is-visible { display: block; }
      .review-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
      .review-card { padding: 18px; border-radius: 22px; background: rgba(255,255,255,.48); border: 1px solid rgba(255,255,255,.8); }
      .review-card span { display: block; margin-bottom: 7px; color: var(--muted); font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
      .review-card strong { font-size: 16px; line-height: 1.45; }
      .review-warning { margin-top: 14px; padding: 15px 17px; border-radius: 18px; background: rgba(255,239,200,.72); border: 1px solid rgba(196,146,37,.22); color: #765313; }
      .review-warning:empty { display: none; }
      .status-line { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; padding: 16px 18px; border-radius: 20px; background: rgba(255,255,255,.46); border: 1px solid rgba(255,255,255,.78); }
      .status-line select { max-width: 190px; }
      .post-picker { grid-template-columns: repeat(3,minmax(0,1fr)); max-height: 330px; overflow: auto; padding: 4px; }
      .post-option { border-radius: 17px; }
      .post-option:has(input:checked) { border-color: rgba(15,159,148,.45); background: rgba(218,249,243,.72); }
      .post-thumb { border-radius: 13px; }
      .media-select-wrap { display: grid; gap: 10px; }
      .selected-media-preview { min-height: 92px; display: grid; place-items: center; overflow: hidden; border-radius: 16px; border: 1px dashed rgba(42,74,104,.2); background: rgba(255,255,255,.38); color: var(--muted); font-size: 12px; }
      .selected-media-preview:empty { display: none; }
      .selected-media-preview img, .selected-media-preview video { display: block; width: 100%; height: 150px; object-fit: cover; }
      @media (max-width: 900px) {
        .wizard-progress { grid-template-columns: repeat(5, 1fr); }
        .wizard-progress button { justify-content: center; min-height: 48px; }
        .step-label { display: none; }
        .choice-grid, .choice-grid.two, .review-grid, .post-picker { grid-template-columns: 1fr; }
        .wizard-step { min-height: auto; border-radius: 24px; }
        .scope-head, .status-line { align-items: flex-start; flex-direction: column; }
        .wizard-footer { bottom: 8px; }
      }
    </style>
    <div class="wizard-ambient"></div>
    <form id="campaignForm" method="post" action="${existing ? `/admin/campaigns/${encodeURIComponent(campaign._id)}` : "/admin/campaigns/new"}">
      <input name="id" type="hidden" value="${esc(campaign._id || "")}">
      <input name="priority" type="hidden" value="${esc(campaign.priority || 0)}">
      <input name="startPayload" type="hidden" value="${esc(campaign.telegram?.startPayload || "")}">

      <div class="wizard-shell">
        <nav class="wizard-progress" aria-label="Этапы настройки">
          ${["Основное", "Триггер", "Ответ", "Telegram", "Проверка"].map((label, index) => `<button type="button" data-step-nav="${index}" ${index === 0 ? `aria-current="step"` : ""}><span class="step-number">${index + 1}</span><span class="step-label">${label}</span></button>`).join("")}
        </nav>
        <div id="wizardError" class="error-banner" role="alert"></div>

        <section class="wizard-step is-active" data-step="0">
          <p class="step-kicker">Шаг 1 из 5</p>
          <h2>Дайте автоматизации понятное имя</h2>
          <p class="step-copy">Оно видно только вам. ID и техническая ссылка Telegram создадутся автоматически.</p>
          <div class="field-card">
            <label for="campaignName">Название автоматизации</label>
            <input id="campaignName" name="name" type="text" value="${esc(campaign.name || "")}" placeholder="Например, Урок по халал-инвестициям" required autofocus>
          </div>
          <div style="margin-top:22px">
            <label>Куда вести подписчика после проверки?</label>
            <div class="choice-grid two">
              <label class="choice-card">
                <input type="radio" name="landingMode" value="default" ${checked(landingMode === "default")}>
                <strong>Стандартный лендинг</strong>
                <small>Использовать адрес из общих настроек. Рекомендуется.</small>
              </label>
              <label class="choice-card">
                <input type="radio" name="landingMode" value="custom" ${checked(landingMode === "custom")}>
                <strong>Другой лендинг</strong>
                <small>Указать отдельную ссылку только для этой автоматизации.</small>
              </label>
            </div>
            <div id="landingDetails" class="mode-details ${landingMode === "custom" ? "" : "is-hidden"}">
              <label for="landingUrl">Ссылка на лендинг</label>
              <input id="landingUrl" name="landingUrl" type="text" value="${esc(campaign.landingUrl || config.landingUrl)}" placeholder="https://example.com/lesson">
            </div>
          </div>
        </section>

        <section class="wizard-step" data-step="1">
          <p class="step-kicker">Шаг 2 из 5</p>
          <h2>Выберите, что запускает сценарий</h2>
          <p class="step-copy">Можно включить несколько событий. Хотя бы одно событие обязательно.</p>
          <div class="choice-grid">
            <label class="choice-card"><input name="comments" type="checkbox" ${checked(triggers.comments)}><strong>Комментарий</strong><small>Ответить человеку, который оставил комментарий под публикацией.</small></label>
            <label class="choice-card"><input name="directMessages" type="checkbox" ${checked(triggers.directMessages)}><strong>Сообщение в Direct</strong><small>Запустить сценарий по входящему сообщению с нужным словом.</small></label>
            <label class="choice-card"><input name="shares" type="checkbox" ${checked(triggers.shares)}><strong>Share / Repost</strong><small>Запустить сценарий, когда публикацией поделились.</small></label>
          </div>

          <div class="scope-box">
            <div class="scope-head"><div><strong>Какие публикации?</strong><br><small>Пустой выбор больше не означает что-то случайное.</small></div>
              <div class="segmented"><label><input type="radio" name="postScope" value="any" ${checked(!selectedMediaIds.size)}>Все</label><label><input type="radio" name="postScope" value="selected" ${checked(Boolean(selectedMediaIds.size))}>Выбранные</label></div>
            </div>
            <div id="postPickerDetails" class="conditional ${selectedMediaIds.size ? "" : "is-hidden"}">${renderPostPicker(posts, selectedMediaIds)}</div>
            <details class="advanced"><summary>Ввести ID публикаций вручную</summary><textarea id="mediaIdsInput" name="mediaIds" placeholder="Один ID в строке">${esc((campaign.mediaIds || []).join("\n"))}</textarea></details>
          </div>

          <div class="scope-box">
            <div class="scope-head"><div><strong>Какие слова?</strong><br><small>Для Share / Repost слова не проверяются.</small></div>
              <div class="segmented"><label><input type="radio" name="keywordScope" value="any" ${checked(!(campaign.keywords || []).length)}>Любые</label><label><input type="radio" name="keywordScope" value="selected" ${checked(Boolean((campaign.keywords || []).length))}>По списку</label></div>
            </div>
            <div id="keywordDetails" class="conditional ${(campaign.keywords || []).length ? "" : "is-hidden"}">
              <label for="keywordsInput">Ключевые слова</label>
              <textarea id="keywordsInput" name="keywords" placeholder="Например: урок, хочу, инвестиции">${esc((campaign.keywords || []).join(", "))}</textarea>
              <small>Разделяйте слова запятыми.</small>
            </div>
          </div>
        </section>

        <section class="wizard-step" data-step="2">
          <p class="step-kicker">Шаг 3 из 5</p>
          <h2>Настройте ответ в Instagram</h2>
          <p class="step-copy">Стандартный ответ уже готов. Меняйте его только если этой кампании нужен отдельный текст или изображение.</p>
          <div class="choice-grid two">
            <label class="choice-card"><input type="radio" name="instagramMessageMode" value="default" ${checked(instagramMessageMode === "default")}><strong>Стандартный ответ</strong><small>Текст, кнопка и изображение берутся из общих настроек.</small></label>
            <label class="choice-card"><input type="radio" name="instagramMessageMode" value="custom" ${checked(instagramMessageMode === "custom")}><strong>Свой ответ</strong><small>Отдельное сообщение только для этой автоматизации.</small></label>
          </div>
          <div id="instagramDetails" class="mode-details ${instagramMessageMode === "custom" ? "" : "is-hidden"}">
            <div class="row">
              <div class="field"><label>Текст сообщения в Direct</label><textarea name="directText">${esc(directMessage.text || "")}</textarea></div>
              <div class="field"><label>Текст кнопки</label><input name="directButtonText" type="text" value="${esc(directMessage.buttonText || "")}"></div>
              <div class="field"><label>Изображение</label>${renderMediaSelect("directImageId", campaign.instagram?.directMedia?.imageId || "", mediaFiles, "Без картинки", "image/")}</div>
            </div>
            <div id="publicReplyBlock" class="status-line conditional ${triggers.comments ? "" : "is-hidden"}">
              <label class="toggle" style="margin:0">Публично ответить на комментарий <input name="publicReplyEnabled" type="checkbox" ${checked(campaign.instagram?.publicReplyEnabled)}></label>
              <div class="field" style="flex:1"><label>Текст публичного ответа</label><input name="publicCommentReply" type="text" value="${esc(campaign.instagram?.publicCommentReply || "")}"></div>
            </div>
          </div>
        </section>

        <section class="wizard-step" data-step="3">
          <p class="step-kicker">Шаг 4 из 5</p>
          <h2>Выберите сценарий в Telegram</h2>
          <p class="step-copy">В большинстве случаев достаточно стандартного сценария — тексты, канал и медиа подтянутся автоматически.</p>
          <div class="choice-grid two">
            <label class="choice-card"><input type="radio" name="telegramMode" value="default" ${checked(telegramMode === "default")}><strong>Стандартный сценарий</strong><small>Использовать текущие общие настройки Telegram.</small></label>
            <label class="choice-card"><input type="radio" name="telegramMode" value="custom" ${checked(telegramMode === "custom")}><strong>Настроить отдельно</strong><small>Задать свой канал, тексты и медиа.</small></label>
          </div>
          <div id="telegramDetails" class="mode-details ${telegramMode === "custom" ? "" : "is-hidden"}">
            <div class="row">
              <div class="field"><label>Канал для проверки</label><input name="channelUsername" type="text" value="${esc(campaign.telegram?.channelUsername || config.telegram?.channelUsername || "")}"></div>
              <div class="field"><label>Приветствие</label><textarea name="tgWelcome">${esc(campaign.telegramTexts?.welcome || "")}</textarea></div>
              <div class="field"><label>Если не подписан</label><textarea name="tgNotSubscribed">${esc(campaign.telegramTexts?.notSubscribed || "")}</textarea></div>
              <div class="field"><label>Если подписан</label><textarea name="tgSubscribed">${esc(campaign.telegramTexts?.subscribed || "")}</textarea></div>
            </div>
            <div class="row" style="margin-top:14px">
              <div class="field"><label>Первое фото</label>${renderMediaSelect("welcomePhoto1Id", campaign.telegramMedia?.welcomePhoto1Id || "", mediaFiles, "Без фото", "image/")}</div>
              <div class="field"><label>Круглое видео</label>${renderMediaSelect("welcomeCircleVideoId", campaign.telegramMedia?.welcomeCircleVideoId || "", mediaFiles, "Без видео", "video/")}</div>
              <div class="field"><label>Второе фото</label>${renderMediaSelect("welcomePhoto2Id", campaign.telegramMedia?.welcomePhoto2Id || "", mediaFiles, "Без фото", "image/")}</div>
              <div class="field"><label>Фото после подписки</label>${renderMediaSelect("subscribedPhotoId", campaign.telegramMedia?.subscribedPhotoId || "", mediaFiles, "Без фото", "image/")}</div>
            </div>
          </div>
        </section>

        <section class="wizard-step" data-step="4">
          <p class="step-kicker">Шаг 5 из 5</p>
          <h2>Проверьте перед сохранением</h2>
          <p class="step-copy">Сводка показывает сценарий обычными словами. Вернитесь на нужный шаг, если что-то хочется изменить.</p>
          <div class="review-grid">
            <div class="review-card"><span>Название</span><strong id="reviewName">—</strong></div>
            <div class="review-card"><span>Запускается по</span><strong id="reviewTriggers">—</strong></div>
            <div class="review-card"><span>Охват</span><strong id="reviewScope">—</strong></div>
            <div class="review-card"><span>Ответ Instagram</span><strong id="reviewInstagram">—</strong></div>
            <div class="review-card"><span>Telegram</span><strong id="reviewTelegram">—</strong></div>
            <div class="review-card"><span>Переход</span><strong id="reviewLanding">—</strong></div>
          </div>
          <div id="reviewWarning" class="review-warning"></div>
          <div class="status-line"><div><strong>Статус после сохранения</strong><br><small>${existing ? "Можно временно приостановить автоматизацию." : "Новая автоматизация сразу начнет работать."}</small></div><select name="status"><option value="active" ${campaign.status !== "paused" ? "selected" : ""}>Активна</option><option value="paused" ${campaign.status === "paused" ? "selected" : ""}>На паузе</option></select></div>
        </section>

        <div class="wizard-footer">
          <a class="button" href="/admin/campaigns">Выйти</a>
          ${existing ? `<button class="danger" type="submit" formaction="/admin/campaigns/${encodeURIComponent(campaign._id)}/delete" formmethod="post" onclick="return confirm('Удалить эту автоматизацию? Это действие нельзя отменить.')">Удалить</button>` : ""}
          <div class="footer-right"><button id="prevStep" type="button">Назад</button><button id="nextStep" class="primary" type="button">Продолжить</button><button id="saveCampaign" class="primary" type="submit" hidden>${existing ? "Сохранить" : "Запустить автоматизацию"}</button></div>
        </div>
      </div>
    </form>
    <script>
      const form = document.getElementById("campaignForm");
      const mediaIdsInput = document.getElementById("mediaIdsInput");
      const steps = Array.from(document.querySelectorAll("[data-step]"));
      const navButtons = Array.from(document.querySelectorAll("[data-step-nav]"));
      const prevButton = document.getElementById("prevStep");
      const nextButton = document.getElementById("nextStep");
      const saveButton = document.getElementById("saveCampaign");
      const errorBanner = document.getElementById("wizardError");
      const otherCampaigns = ${scriptJson(conflictCampaigns)};
      let currentStep = 0;

      function selectedValue(name) {
        const input = form.querySelector('[name="' + name + '"]:checked');
        return input ? input.value : "";
      }
      function toggleDetails(name, value, targetId) {
        document.getElementById(targetId).classList.toggle("is-hidden", selectedValue(name) !== value);
      }
      function syncConditionalUi() {
        toggleDetails("landingMode", "custom", "landingDetails");
        toggleDetails("instagramMessageMode", "custom", "instagramDetails");
        toggleDetails("telegramMode", "custom", "telegramDetails");
        toggleDetails("postScope", "selected", "postPickerDetails");
        toggleDetails("keywordScope", "selected", "keywordDetails");
        document.getElementById("publicReplyBlock").classList.toggle("is-hidden", !form.elements.comments.checked);
      }
      function syncMediaIds() {
        if (selectedValue("postScope") === "any") {
          mediaIdsInput.value = "";
          return;
        }
        const selectedPosts = Array.from(document.querySelectorAll("[data-post-id]:checked")).map((item) => item.value);
        if (selectedPosts.length) mediaIdsInput.value = selectedPosts.join("\\n");
      }
      function valuesList(value) {
        return String(value || "").split(/[\\n,]/).map((item) => item.trim()).filter(Boolean);
      }
      function showError(message) {
        errorBanner.textContent = message;
        errorBanner.classList.add("is-visible");
        errorBanner.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      function clearError() { errorBanner.classList.remove("is-visible"); errorBanner.textContent = ""; }
      function validateStep(index) {
        clearError();
        if (index === 0 && !form.elements.name.value.trim()) { showError("Введите название автоматизации."); form.elements.name.focus(); return false; }
        if (index === 0 && selectedValue("landingMode") === "custom" && !form.elements.landingUrl.value.trim()) { showError("Укажите ссылку на лендинг."); form.elements.landingUrl.focus(); return false; }
        if (index === 1) {
          if (!form.elements.comments.checked && !form.elements.directMessages.checked && !form.elements.shares.checked) { showError("Выберите хотя бы одно событие: комментарий, Direct или Share / Repost."); return false; }
          syncMediaIds();
          if (selectedValue("postScope") === "selected" && !valuesList(mediaIdsInput.value).length) { showError("Выберите хотя бы одну публикацию или введите её ID вручную."); return false; }
          if (selectedValue("keywordScope") === "selected" && !valuesList(form.elements.keywords.value).length) { showError("Добавьте хотя бы одно ключевое слово."); form.elements.keywords.focus(); return false; }
        }
        return true;
      }
      function updateReview() {
        syncMediaIds();
        const triggerLabels = [];
        if (form.elements.comments.checked) triggerLabels.push("комментарию");
        if (form.elements.directMessages.checked) triggerLabels.push("сообщению в Direct");
        if (form.elements.shares.checked) triggerLabels.push("Share / Repost");
        const media = valuesList(mediaIdsInput.value);
        const keywords = selectedValue("keywordScope") === "any" ? [] : valuesList(form.elements.keywords.value);
        document.getElementById("reviewName").textContent = form.elements.name.value.trim() || "Без названия";
        document.getElementById("reviewTriggers").textContent = triggerLabels.join(", ") || "Не выбрано";
        document.getElementById("reviewScope").textContent = (media.length ? media.length + " выбранных публикаций" : "все публикации") + "; " + (keywords.length ? keywords.length + " ключевых слов" : "любой текст");
        document.getElementById("reviewInstagram").textContent = selectedValue("instagramMessageMode") === "default" ? "стандартный ответ" : "собственный ответ";
        document.getElementById("reviewTelegram").textContent = selectedValue("telegramMode") === "default" ? "стандартный сценарий" : "индивидуальный сценарий";
        document.getElementById("reviewLanding").textContent = selectedValue("landingMode") === "default" ? "стандартный лендинг" : form.elements.landingUrl.value.trim();
        const warnings = [];
        if (!media.length) warnings.push("Автоматизация реагирует на все публикации.");
        if (!keywords.length && (form.elements.comments.checked || form.elements.directMessages.checked)) warnings.push("Она реагирует на любой текст.");
        const triggerKeys = ["comments", "directMessages", "shares"].filter((key) => form.elements[key].checked);
        const overlaps = otherCampaigns.filter((campaign) => triggerKeys.some((key) => campaign.triggers && campaign.triggers[key]) && (!media.length || !campaign.mediaIds.length || campaign.mediaIds.some((id) => media.includes(String(id)))) && (!keywords.length || !campaign.keywords.length || campaign.keywords.some((word) => keywords.map((item) => item.toLowerCase()).includes(String(word).toLowerCase()))));
        if (overlaps.length) warnings.push("Возможное пересечение с: " + overlaps.slice(0, 3).map((item) => item.name).join(", ") + ". Сработает автоматизация с более высоким приоритетом.");
        document.getElementById("reviewWarning").textContent = warnings.join(" ");
      }
      function showStep(index) {
        currentStep = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === currentStep));
        navButtons.forEach((button, stepIndex) => {
          button.toggleAttribute("aria-current", stepIndex === currentStep);
          if (stepIndex === currentStep) button.setAttribute("aria-current", "step");
          button.classList.toggle("is-done", stepIndex < currentStep);
        });
        prevButton.hidden = currentStep === 0;
        nextButton.hidden = currentStep === steps.length - 1;
        saveButton.hidden = currentStep !== steps.length - 1;
        if (currentStep === steps.length - 1) updateReview();
        clearError();
        document.querySelector(".wizard-progress").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      form.addEventListener("change", syncConditionalUi);
      form.querySelectorAll("[data-media-select]").forEach((select) => {
        const preview = select.parentElement.querySelector("[data-media-preview]");
        const updateMediaPreview = () => {
          const option = select.selectedOptions[0];
          const url = option ? option.dataset.preview || "" : "";
          const type = option ? option.dataset.type || "" : "";
          preview.replaceChildren();
          if (!url) return;
          const media = document.createElement(type.startsWith("video/") ? "video" : "img");
          media.src = url;
          media.alt = "Выбранный медиафайл";
          if (media.tagName === "VIDEO") { media.muted = true; media.controls = true; media.preload = "metadata"; }
          preview.append(media);
        };
        select.addEventListener("change", updateMediaPreview);
        updateMediaPreview();
      });
      prevButton.addEventListener("click", () => showStep(currentStep - 1));
      nextButton.addEventListener("click", () => { if (validateStep(currentStep)) showStep(currentStep + 1); });
      navButtons.forEach((button, index) => button.addEventListener("click", () => {
        if (index <= currentStep) showStep(index);
        else if (index === currentStep + 1 && validateStep(currentStep)) showStep(index);
      }));
      form.addEventListener("submit", (event) => {
        if (event.submitter && event.submitter.classList.contains("danger")) return;
        for (let index = 0; index < steps.length - 1; index += 1) { if (!validateStep(index)) { event.preventDefault(); showStep(index); return; } }
        syncMediaIds();
        if (selectedValue("keywordScope") === "any") form.elements.keywords.value = "";
      });
      syncConditionalUi();
      showStep(0);
    </script>`;
  return renderAdminShell(existing ? "Редактировать автоматизацию" : "Новая автоматизация", config, content);
}

function renderPostPicker(posts, selectedIds) {
  if (!posts.length) {
    return `
      <div class="panel" style="box-shadow:none;margin-top:14px">
        <h2>Instagram posts/Reels</h2>
        <p class="muted">Посты еще не синхронизированы. Открой /admin/posts и нажми синхронизацию, потом вернись сюда.</p>
        <a class="button" href="/admin/posts">Открыть Posts</a>
      </div>`;
  }

  return `
    <div style="margin-top:18px">
      <h2>Выбрать posts/Reels</h2>
      <div class="post-picker">
        ${posts.map((post) => renderPostPickerItem(post, selectedIds.has(String(post.id)))).join("")}
      </div>
    </div>`;
}

function renderPostPickerItem(post, selected) {
  const imageUrl = post.thumbnailUrl || post.mediaUrl || "";
  const preview = imageUrl
    ? `<img src="${esc(imageUrl)}" alt="" class="post-thumb">`
    : `<div class="post-thumb placeholder">No preview</div>`;
  return `
    <label class="post-option">
      <input data-post-id type="checkbox" value="${esc(post.id)}" ${checked(selected)}>
      ${preview}
      <span>
        <strong>${esc(post.mediaType || "MEDIA")}</strong>
        <small>${esc(truncateText(post.caption || post.id, 70))}</small>
      </span>
    </label>`;
}

function renderMediaSelect(name, selectedId, files, emptyLabel, contentPrefix) {
  const filtered = files
    .filter((file) => !contentPrefix || String(file.contentType || "").startsWith(contentPrefix))
  const hasSelected = !selectedId || filtered.some((file) => file.id === selectedId);
  const customOption = selectedId && !hasSelected
    ? `<option value="${esc(selectedId)}" selected>${esc(`Current: ${selectedId}`)}</option>`
    : "";
  const options = filtered
    .map((file) => `<option value="${esc(file.id)}" data-preview="${esc(mediaAdminUrl(file.id))}" data-type="${esc(file.contentType || "")}" ${file.id === selectedId ? "selected" : ""}>${esc(mediaOptionLabel(file))}</option>`)
    .join("");

  return `
    <div class="media-select-wrap">
      <select name="${esc(name)}" data-media-select>
        <option value="">${esc(emptyLabel)}</option>
        ${customOption}
        ${options}
      </select>
      <div class="selected-media-preview" data-media-preview></div>
    </div>`;
}

function mediaOptionLabel(file) {
  const purpose = file.metadata?.purpose ? ` · ${file.metadata.purpose}` : "";
  return `${file.filename} · ${formatBytes(file.length)}${purpose}`;
}

function renderComingSoon(title, text) {
  return `
    <section class="panel">
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(text)}</p>
      <div class="meta">
        <a class="button" href="/admin/campaigns">Автоматизации</a>
        <a class="button" href="/admin">Settings</a>
      </div>
    </section>`;
}

function renderMediaLibrary(config, files, mongoEnabled) {
  const content = `
    <form class="section" method="post" action="/admin/media" enctype="multipart/form-data">
      <h2>Загрузить файл</h2>
      <div class="row">
        <div class="field">
          <label>Purpose</label>
          <input name="purpose" type="text" value="media_library">
          <small>Например: instagram_direct_image или telegram_subscribed_photo.</small>
        </div>
        <div class="field">
          <label>Файл</label>
          <input name="mediaFile" type="file" accept="image/*,video/*" required>
          <small>Изображения до ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)} будут сжаты сервером. Видео пока до ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}.</small>
        </div>
      </div>
      <div class="actions">
        <div class="muted">Файл сохранится в MongoDB GridFS и появится ниже.</div>
        <button class="primary" type="submit">Загрузить</button>
      </div>
    </form>

    ${mongoEnabled ? renderMediaGrid(files) : `
      <section class="panel">
        <h2>MongoDB не настроен</h2>
        <p class="muted">Media library работает только при настроенном MONGODB_URI.</p>
      </section>`}

    <script>
      for (const button of document.querySelectorAll("[data-copy]")) {
        button.addEventListener("click", async () => {
          const value = button.getAttribute("data-copy");
          try {
            await navigator.clipboard.writeText(value);
            button.textContent = "Скопировано";
            setTimeout(() => { button.textContent = "Copy ID"; }, 1200);
          } catch {
            prompt("Media ID", value);
          }
        });
      }
    </script>`;
  return renderAdminShell("Media library", config, content);
}

function renderInstagramPosts(config, posts, mongoEnabled) {
  const content = `
    <form class="section" method="post" action="/admin/posts">
      <h2>Синхронизация</h2>
      <div class="row">
        <div class="field">
          <label>Источник</label>
          <input type="text" value="META_ACCESS_TOKEN / /me/media" readonly>
          <small>OAuth пока не используем. Синхронизируется текущий подключенный Instagram аккаунт.</small>
        </div>
        <div class="field">
          <label>Состояние</label>
          <input type="text" value="${mongoEnabled ? `${posts.length} saved posts/Reels` : "MongoDB не настроен"}" readonly>
        </div>
      </div>
      <div class="actions">
        <div class="muted">После sync скопируй media ID или permalink, затем вставь media ID в автоматизацию.</div>
        <button class="primary" type="submit" ${mongoEnabled ? "" : "disabled"}>Синхронизировать posts/Reels</button>
      </div>
    </form>

    ${mongoEnabled ? renderInstagramPostGrid(posts) : `
      <section class="panel">
        <h2>MongoDB не настроен</h2>
        <p class="muted">Список постов хранится в MongoDB, поэтому нужен MONGODB_URI.</p>
      </section>`}

    <script>
      for (const button of document.querySelectorAll("[data-copy]")) {
        button.addEventListener("click", async () => {
          const value = button.getAttribute("data-copy");
          try {
            await navigator.clipboard.writeText(value);
            button.textContent = "Скопировано";
            setTimeout(() => { button.textContent = "Copy ID"; }, 1200);
          } catch {
            prompt("Media ID", value);
          }
        });
      }
    </script>`;
  return renderAdminShell("Instagram posts", config, content);
}

function renderInstagramPostGrid(posts) {
  if (!posts.length) {
    return `
      <section class="panel">
        <h2>Посты еще не синхронизированы</h2>
        <p class="muted">Нажми синхронизацию выше. После этого здесь появятся post/Reels media IDs для автоматизаций.</p>
      </section>`;
  }

  return `
    <section class="grid">
      ${posts.map(renderInstagramPostCard).join("")}
    </section>`;
}

function renderInstagramPostCard(post) {
  const imageUrl = post.thumbnailUrl || post.mediaUrl || "";
  const preview = imageUrl
    ? `<img src="${esc(imageUrl)}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.7)">`
    : `<div class="panel" style="box-shadow:none;aspect-ratio:1/1;display:grid;place-items:center">No preview</div>`;
  const caption = truncateText(post.caption || "", 120);

  return `
    <article class="card">
      ${preview}
      <div class="meta">
        <span class="pill">${esc(post.mediaType || "MEDIA")}</span>
        <span class="pill">${esc(formatInstagramDate(post.timestamp))}</span>
      </div>
      <p>${esc(caption || "Без подписи")}</p>
      <input type="text" readonly value="${esc(post.id)}" onclick="this.select()">
      <div class="meta">
        <button type="button" data-copy="${esc(post.id)}">Copy ID</button>
        ${post.permalink ? `<a class="button" href="${esc(post.permalink)}" target="_blank" rel="noreferrer">Instagram</a>` : ""}
      </div>
    </article>`;
}

function formatInstagramDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function renderMediaGrid(files) {
  if (!files.length) {
    return `
      <section class="panel">
        <h2>Файлов пока нет</h2>
        <p class="muted">Загрузи первое изображение или видео, затем используй media ID в автоматизациях.</p>
      </section>`;
  }

  return `
    <section class="grid">
      ${files.map(renderMediaCard).join("")}
    </section>`;
}

function renderMediaCard(file) {
  const url = mediaAdminUrl(file.id);
  const isImage = String(file.contentType || "").startsWith("image/");
  const isVideo = String(file.contentType || "").startsWith("video/");
  const preview = isImage
    ? mediaPreview(url, file.filename)
    : isVideo
      ? videoPreview(url)
      : `<div class="panel" style="box-shadow:none;min-height:180px;display:grid;place-items:center">No preview</div>`;

  return `
    <article class="card">
      ${preview}
      <div class="meta">
        <span class="pill">${esc(file.contentType || "unknown")}</span>
        <span class="pill">${formatBytes(file.length)}</span>
      </div>
      <h2 style="margin-top:14px">${esc(file.filename)}</h2>
      <p class="muted">Purpose: ${esc(file.metadata?.purpose || "unknown")}</p>
      <p class="muted">Uploaded: ${esc(formatDate(file.uploadDate))}</p>
      <input type="text" readonly value="${esc(file.id)}" onclick="this.select()">
      <div class="meta">
        <button type="button" data-copy="${esc(file.id)}">Copy ID</button>
        <a class="button" href="${esc(url)}" target="_blank" rel="noreferrer">Open</a>
        <a class="button" href="${esc(url)}&info=1" target="_blank" rel="noreferrer">Info</a>
      </div>
    </article>`;
}

function renderAdmin(config) {
  const keywords = Array.isArray(config.instagram.keywords) ? config.instagram.keywords.join(", ") : "";
  const directImageUrl = config.instagram.directMedia?.imageId ? mediaAdminUrl(config.instagram.directMedia.imageId) : "";
  const welcomePhoto1Id = config.telegramMedia?.welcomePhoto1Id || config.telegramMedia?.welcomeImageId || "";
  const welcomePhoto1Url = welcomePhoto1Id ? mediaAdminUrl(welcomePhoto1Id) : "";
  const welcomeCircleVideoUrl = config.telegramMedia?.welcomeCircleVideoId ? mediaAdminUrl(config.telegramMedia.welcomeCircleVideoId) : "";
  const welcomePhoto2Url = config.telegramMedia?.welcomePhoto2Id ? mediaAdminUrl(config.telegramMedia.welcomePhoto2Id) : "";
  const subscribedPhotoUrl = config.telegramMedia?.subscribedPhotoId ? mediaAdminUrl(config.telegramMedia.subscribedPhotoId) : "";
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
      <a href="/admin/campaigns">Автоматизации</a>
      <a href="/admin/posts">Posts</a>
      <a href="/admin/media">Media</a>
      <a href="/stats">Stats</a>
      <a href="/telegram/webhook-info">Telegram webhook</a>
      <a href="/admin/logout">Logout</a>
    </nav>
  </div>
  <form method="post" action="/admin" enctype="multipart/form-data">
    <section class="section">
      <h2>Основное</h2>
      <div class="row">
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
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>Фото приветствия в Direct</label>
          <input class="media-input" name="directImage" type="file" accept="image/*">
          <small>Для Instagram Direct. Если Meta не примет карточку с фото, бот попробует обычный ответ.</small>
        </div>
        <div class="field">
          <label>Текущее фото Direct</label>
          ${directImageUrl ? mediaPreview(directImageUrl, "Direct image") : `<div class="hint">Фото не загружено.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить фото Direct <input name="removeDirectImage" type="checkbox"></label>
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
          <label>1. Фото приветствия</label>
          <input class="media-input" name="welcomeImage" type="file" accept="image/*">
          <small>Хранится в MongoDB GridFS. Сервер автоматически повернет, уменьшит и сожмет изображение.</small>
        </div>
        <div class="field">
          <label>Текущее фото 1</label>
          ${welcomePhoto1Url ? mediaPreview(welcomePhoto1Url, "Welcome image") : `<div class="hint">Фото не загружено.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить фото 1 <input name="removeWelcomeImage" type="checkbox"></label>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>2. Кружок Telegram</label>
          <input name="welcomeCircleVideo" type="file" accept="video/*">
          <small>Лучше короткий квадратный MP4 до 1.5 MB. Отправляется через sendVideoNote.</small>
        </div>
        <div class="field">
          <label>Текущий кружок</label>
          ${welcomeCircleVideoUrl ? videoPreview(welcomeCircleVideoUrl) : `<div class="hint">Видео не загружено.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить кружок <input name="removeWelcomeCircleVideo" type="checkbox"></label>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>3. Фото перед проверкой</label>
          <input class="media-input" name="welcomePhoto2" type="file" accept="image/*">
          <small>Это сообщение идет с кнопками “Арнаға жазылу” и “Жазылдым”.</small>
        </div>
        <div class="field">
          <label>Текущее фото 2</label>
          ${welcomePhoto2Url ? mediaPreview(welcomePhoto2Url, "Second welcome image") : `<div class="hint">Фото не загружено.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить фото 2 <input name="removeWelcomePhoto2" type="checkbox"></label>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field">
          <label>Фото после подписки</label>
          <input class="media-input" name="subscribedPhoto" type="file" accept="image/*">
          <small>Если пользователь подписан, отправится фото + текст + кнопка лендинга.</small>
        </div>
        <div class="field">
          <label>Текущее фото после подписки</label>
          ${subscribedPhotoUrl ? mediaPreview(subscribedPhotoUrl, "Subscribed image") : `<div class="hint">Фото не загружено.</div>`}
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:22px">Удалить фото после подписки <input name="removeSubscribedPhoto" type="checkbox"></label>
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
      files: {},
      errors: []
    };
  }

  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const errors = [];
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_IMAGE_UPLOAD_BYTES,
        files: MAX_ADMIN_UPLOAD_FIELDS,
        fields: 80
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      let tooLarge = false;
      const filename = info.filename || "";

      if (!filename) {
        file.resume();
        return;
      }

      file.on("data", (chunk) => {
        if (!tooLarge) chunks.push(chunk);
      });
      file.on("limit", () => {
        tooLarge = true;
        chunks.length = 0;
      });
      file.on("end", () => {
        if (tooLarge) {
          files[name] = { tooLarge: true };
          return;
        }

        const buffer = Buffer.concat(chunks);
        if (buffer.length > 0) {
          files[name] = {
            buffer,
            filename,
            contentType: info.mimeType
          };
          return;
        }

        errors.push(`Файл "${filename}" пустой или не был передан браузером.`);
      });
    });

    busboy.on("filesLimit", () => {
      errors.push("Слишком много файлов в форме. Обновите страницу и попробуйте загрузить только нужные файлы.");
    });
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (Object.keys(files).length > 0) {
        console.log(
          `Admin upload files: ${Object.entries(files)
            .map(([name, file]) => `${name}:${file.filename || "unknown"}:${file.contentType || "unknown"}:${file.buffer?.length || 0}`)
            .join(", ")}`
        );
      }
      const sizeErrors = Object.values(files).some((file) => file.tooLarge)
        ? [`Файл слишком большой. Максимум ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)} для изображений и ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)} для видео.`]
        : [];
      resolve({ fields, files, errors: [...errors, ...sizeErrors] });
    });
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
