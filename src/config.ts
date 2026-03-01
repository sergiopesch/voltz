import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = join(__dirname, "..");
export const VOLTZ_DIR = join(homedir(), ".voltz");
export const CONFIG_PATH = join(VOLTZ_DIR, "config.json");
export const SESSION_PATH = join(VOLTZ_DIR, "session.json");
export const STT_BINARY = join(PROJECT_ROOT, "swift", ".build", "release", "VoltzSTT");
export const KNOWLEDGE_PATH = join(PROJECT_ROOT, "knowledge", "electronics.md");

export interface VoltzConfig {
  apiKey: string;
}

export function ensureVoltzDir(): void {
  if (!existsSync(VOLTZ_DIR)) {
    mkdirSync(VOLTZ_DIR, { recursive: true });
  }
}

export function loadConfig(): VoltzConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: VoltzConfig): void {
  ensureVoltzDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  const config = loadConfig();
  if (config?.apiKey) return config.apiKey;

  throw new Error(
    "No API key found. Set ANTHROPIC_API_KEY or run: voltz setup"
  );
}

export function loadSessionId(): string | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(SESSION_PATH, "utf-8"));
    return data.sessionId ?? null;
  } catch {
    return null;
  }
}

export function saveSessionId(sessionId: string): void {
  ensureVoltzDir();
  writeFileSync(SESSION_PATH, JSON.stringify({ sessionId }, null, 2) + "\n");
}
