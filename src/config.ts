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
export const CONFIG_LOCAL_PATH = join(VOLTZ_DIR, "config.local.json");
export const SESSION_PATH = join(VOLTZ_DIR, "session.json");
export const STT_BINARY = join(PROJECT_ROOT, "swift", ".build", "release", "VoltzSTT");
export const KNOWLEDGE_PATH = join(PROJECT_ROOT, "knowledge", "electronics.md");

export interface VoltzConfig {
  apiKey: string;
  /** STT engine name (default: auto-detect) */
  sttEngine?: string;
  /** TTS engine name (default: auto-detect) */
  ttsEngine?: string;
  /** TTS voice name (default: Samantha) */
  ttsVoice?: string;
  /** Silence timeout for STT in seconds (default: 1.5) */
  silenceTimeout?: number;
  /** Max recording duration in seconds (default: 30) */
  maxDuration?: number;
  /** Log level: debug, info, warn, error (default: info) */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Custom system prompt appended to the default */
  systemPromptAppend?: string;
}

export function ensureVoltzDir(): void {
  if (!existsSync(VOLTZ_DIR)) {
    mkdirSync(VOLTZ_DIR, { recursive: true });
  }
}

function loadJsonFile(path: string): Partial<VoltzConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load config with two-tier override:
 *   config.json (shared/committed) ← config.local.json (personal overrides)
 *
 * Fields from local override merge on top of base, field by field.
 */
export function loadConfig(): VoltzConfig | null {
  const base = loadJsonFile(CONFIG_PATH);
  const local = loadJsonFile(CONFIG_LOCAL_PATH);

  if (!base && !local) return null;

  return { apiKey: "", ...base, ...local } as VoltzConfig;
}

export function saveConfig(config: Partial<VoltzConfig>): void {
  ensureVoltzDir();
  const existing = loadJsonFile(CONFIG_PATH) ?? {};
  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * Save personal overrides to config.local.json.
 * These take priority over config.json.
 */
export function saveLocalConfig(config: Partial<VoltzConfig>): void {
  ensureVoltzDir();
  const existing = loadJsonFile(CONFIG_LOCAL_PATH) ?? {};
  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_LOCAL_PATH, JSON.stringify(merged, null, 2) + "\n");
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
