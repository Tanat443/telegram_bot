import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStoredConfig, saveStoredConfig } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "data", "config.json");
const runtimeConfigPath = path.join(os.tmpdir(), "instagram-telegram-gate-config.json");

export function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  return fs.readFile(envPath, "utf8")
    .then((content) => {
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
    })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
}

export async function readConfig() {
  const storedConfig = await getStoredConfig();
  if (storedConfig) return applyEnvOverrides(storedConfig);

  let config;
  try {
    const runtimeContent = await fs.readFile(runtimeConfigPath, "utf8");
    config = JSON.parse(runtimeContent);
    return applyEnvOverrides(config);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const content = await fs.readFile(configPath, "utf8");
  config = JSON.parse(content);
  return applyEnvOverrides(config);
}

export async function writeConfig(config) {
  if (await saveStoredConfig(config)) return;

  const content = `${JSON.stringify(config, null, 2)}\n`;

  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, content, "utf8");
    return;
  } catch (error) {
    if (error.code !== "EROFS") throw error;
  }

  await fs.writeFile(runtimeConfigPath, content, "utf8");
}

export function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

export function requireEnv(name) {
  const value = getEnv(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function normalizeUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function applyEnvOverrides(config) {
  config.instagram = config.instagram || {};
  config.instagram.directMedia = config.instagram.directMedia || { imageId: "" };
  config.telegramMedia = config.telegramMedia || {};
  config.telegramMedia.welcomePhoto1Id = config.telegramMedia.welcomePhoto1Id || config.telegramMedia.welcomeImageId || "";
  config.telegramMedia.welcomeCircleVideoId = config.telegramMedia.welcomeCircleVideoId || "";
  config.telegramMedia.welcomePhoto2Id = config.telegramMedia.welcomePhoto2Id || "";
  config.telegramMedia.subscribedPhotoId = config.telegramMedia.subscribedPhotoId || "";
  config.telegramTexts = config.telegramTexts || {};
  if (!config.telegramTexts.channelButton || config.telegramTexts.channelButton === "Подписаться на канал") {
    config.telegramTexts.channelButton = "Арнаға жазылу";
  }
  if (!config.telegramTexts.checkButton || config.telegramTexts.checkButton === "Проверить подписку") {
    config.telegramTexts.checkButton = "Жазылдым";
  }

  if (process.env.TELEGRAM_CHANNEL_USERNAME) {
    config.telegram.channelUsername = process.env.TELEGRAM_CHANNEL_USERNAME;
  }
  if (process.env.LANDING_URL) {
    config.landingUrl = normalizeUrl(process.env.LANDING_URL);
  }
  return config;
}
