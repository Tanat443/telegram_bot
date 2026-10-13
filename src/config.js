import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  try {
    const runtimeContent = await fs.readFile(runtimeConfigPath, "utf8");
    return JSON.parse(runtimeContent);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const content = await fs.readFile(configPath, "utf8");
  return JSON.parse(content);
}

export async function writeConfig(config) {
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
