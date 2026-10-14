import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getActiveCampaigns, getCampaignById, getCampaignByStartPayload, getStoredConfig, saveStoredConfig } from "./db.js";

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

export async function readCampaigns(config = null) {
  const baseConfig = config || await readConfig();
  const storedCampaigns = await getActiveCampaigns();
  const configuredCampaigns = Array.isArray(baseConfig.campaigns) ? baseConfig.campaigns : [];
  const campaigns = storedCampaigns.length > 0 ? storedCampaigns : configuredCampaigns;

  if (campaigns.length === 0) return [defaultCampaignFromConfig(baseConfig)];
  return campaigns.map((campaign) => normalizeCampaign(campaign, baseConfig));
}

export async function readConfigForCampaignId(campaignId) {
  const config = await readConfig();
  if (!campaignId || campaignId === "default") return withCampaignContext(config, defaultCampaignFromConfig(config));

  const storedCampaign = await getCampaignById(campaignId);
  const configuredCampaign = Array.isArray(config.campaigns)
    ? config.campaigns.find((campaign) => String(campaign._id || campaign.id) === String(campaignId))
    : null;
  const campaign = storedCampaign || configuredCampaign;
  if (!campaign) return withCampaignContext(config, defaultCampaignFromConfig(config));

  return mergeConfigWithCampaign(config, normalizeCampaign(campaign, config));
}

export async function readConfigForStartPayload(payload) {
  const config = await readConfig();
  const normalizedPayload = String(payload || "").trim();
  if (!normalizedPayload || normalizedPayload === config.telegram?.startPayload) {
    return withCampaignContext(config, defaultCampaignFromConfig(config));
  }

  const storedCampaign = await getCampaignByStartPayload(normalizedPayload);
  const configuredCampaign = Array.isArray(config.campaigns)
    ? config.campaigns.find((campaign) => String(campaign.telegram?.startPayload || campaign.startPayload || "") === normalizedPayload)
    : null;
  const campaign = storedCampaign || configuredCampaign;
  if (!campaign) return withCampaignContext(config, defaultCampaignFromConfig(config));

  return mergeConfigWithCampaign(config, normalizeCampaign(campaign, config));
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

export function mergeConfigWithCampaign(config, campaign) {
  const normalizedCampaign = normalizeCampaign(campaign, config);
  return withCampaignContext({
    ...config,
    landingUrl: normalizedCampaign.landingUrl,
    telegram: {
      ...config.telegram,
      ...normalizedCampaign.telegram
    },
    telegramTexts: {
      ...config.telegramTexts,
      ...normalizedCampaign.telegramTexts
    },
    telegramMedia: {
      ...config.telegramMedia,
      ...normalizedCampaign.telegramMedia
    },
    instagram: {
      ...config.instagram,
      enabledTriggers: {
        ...config.instagram?.enabledTriggers,
        ...normalizedCampaign.instagram.enabledTriggers
      },
      keywords: normalizedCampaign.keywords,
      publicReplyEnabled: normalizedCampaign.instagram.publicReplyEnabled,
      publicCommentReply: normalizedCampaign.instagram.publicCommentReply,
      directMessage: {
        ...config.instagram?.directMessage,
        ...normalizedCampaign.instagram.directMessage
      },
      directMedia: {
        ...config.instagram?.directMedia,
        ...normalizedCampaign.instagram.directMedia
      }
    }
  }, normalizedCampaign);
}

function defaultCampaignFromConfig(config) {
  return normalizeCampaign({
    _id: "default",
    name: "Default campaign",
    status: "active",
    mediaIds: [],
    keywords: config.instagram?.keywords || [],
    landingUrl: config.landingUrl,
    telegram: config.telegram || {},
    telegramTexts: config.telegramTexts || {},
    telegramMedia: config.telegramMedia || {},
    instagram: config.instagram || {}
  }, config);
}

function normalizeCampaign(campaign, config) {
  const id = String(campaign?._id || campaign?.id || "default");
  const telegram = campaign?.telegram || {};
  const instagram = campaign?.instagram || {};
  const directMessage = instagram.directMessage || {};

  return {
    _id: id,
    id,
    name: campaign?.name || (id === "default" ? "Default campaign" : id),
    status: campaign?.status || "active",
    mediaIds: normalizeStringArray(campaign?.mediaIds),
    keywords: normalizeStringArray(campaign?.keywords ?? config.instagram?.keywords),
    landingUrl: normalizeUrl(campaign?.landingUrl || config.landingUrl || ""),
    telegram: {
      channelUsername: telegram.channelUsername || campaign?.telegramChannelUsername || config.telegram?.channelUsername || "",
      startPayload: telegram.startPayload || campaign?.startPayload || (id === "default" ? config.telegram?.startPayload || "ig" : `camp_${id}`)
    },
    telegramTexts: {
      ...config.telegramTexts,
      ...(campaign?.telegramTexts || {}),
      ...(telegram.texts || {})
    },
    telegramMedia: {
      ...config.telegramMedia,
      ...(campaign?.telegramMedia || {}),
      ...(telegram.media || {})
    },
    instagram: {
      enabledTriggers: {
        ...config.instagram?.enabledTriggers,
        ...(instagram.enabledTriggers || {}),
        ...(instagram.triggers || {}),
        comments: instagram.comments ?? instagram.enabledTriggers?.comments ?? instagram.triggers?.comments ?? config.instagram?.enabledTriggers?.comments ?? true,
        directMessages: instagram.directMessages ?? instagram.enabledTriggers?.directMessages ?? instagram.triggers?.directMessages ?? config.instagram?.enabledTriggers?.directMessages ?? false,
        shares: instagram.shares ?? instagram.enabledTriggers?.shares ?? instagram.triggers?.shares ?? config.instagram?.enabledTriggers?.shares ?? false
      },
      publicReplyEnabled: instagram.publicReplyEnabled ?? config.instagram?.publicReplyEnabled ?? false,
      publicCommentReply: instagram.publicCommentReply ?? config.instagram?.publicCommentReply ?? "",
      directMessage: {
        text: directMessage.text || instagram.privateReplyText || config.instagram?.directMessage?.text || "",
        buttonText: directMessage.buttonText || instagram.buttonText || config.instagram?.directMessage?.buttonText || "Open"
      },
      directMedia: {
        ...config.instagram?.directMedia,
        ...(instagram.directMedia || {}),
        imageId: instagram.imageId || instagram.directMedia?.imageId || config.instagram?.directMedia?.imageId || ""
      }
    }
  };
}

function withCampaignContext(config, campaign) {
  return {
    ...config,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      mediaIds: campaign.mediaIds
    }
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}
