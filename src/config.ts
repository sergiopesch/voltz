import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = join(__dirname, "..");
export const VOLTZ_DIR = join(homedir(), ".voltz");
export const CONFIG_PATH = join(VOLTZ_DIR, "config.json");
export const CONFIG_LOCAL_PATH = join(VOLTZ_DIR, "config.local.json");
export const SESSION_PATH = join(VOLTZ_DIR, "session.json");
export const STT_BINARY = join(PROJECT_ROOT, "swift", ".build", "release", "VoltzSTT");
export const KNOWLEDGE_PATH = join(PROJECT_ROOT, "knowledge", "electronics.md");
export const SUPPORTED_PROVIDERS = ["anthropic", "openai-compatible"] as const;
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export type ProviderName = typeof SUPPORTED_PROVIDERS[number];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5-20250514",
  "openai-compatible": "gpt-4.1-mini",
};

export interface VoltzConfig {
  apiKey: string;
  /** LLM provider (default: anthropic) */
  provider?: ProviderName;
  /** Base URL for OpenAI-compatible providers */
  baseURL?: string;
  /** STT engine name (default: auto-detect) */
  sttEngine?: string;
  /** Linux/local STT model path (for whisper.cpp-style backends) */
  sttModelPath?: string;
  /** Optional Linux microphone override, for example "pulse:default" or "alsa:hw:1,0" */
  micDevice?: string;
  /** Preferred STT language code such as en or en-US */
  sttLanguage?: string;
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
  /** Rate limit: max queries per hour (default: 60) */
  maxPerHour?: number;
  /** Rate limit: max queries per day (default: 500) */
  maxPerDay?: number;
  /** Custom system prompt appended to the default */
  systemPromptAppend?: string;
  /** Model ID for the configured provider */
  model?: string;
  /** Enable Bash tool for the agent (default: false) */
  dangerousTools?: boolean;
}

const VoltzConfigFields = {
  provider: z.enum(SUPPORTED_PROVIDERS).optional(),
  baseURL: z.string().url().optional(),
  sttEngine: z.string().optional(),
  sttModelPath: z.string().optional(),
  micDevice: z.string().optional(),
  sttLanguage: z.string().optional(),
  ttsEngine: z.string().optional(),
  ttsVoice: z.string().optional(),
  silenceTimeout: z.number().min(0.5).max(10).optional(),
  maxDuration: z.number().min(5).max(300).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  maxPerHour: z.number().int().min(1).optional(),
  maxPerDay: z.number().int().min(1).optional(),
  systemPromptAppend: z.string().optional(),
  model: z.string().optional(),
  dangerousTools: z.boolean().optional(),
} as const;

export const VoltzConfigSchema = z.object({
  apiKey: z.string().default(""),
  ...VoltzConfigFields,
}).passthrough();

export function ensureVoltzDir(): void {
  if (!existsSync(VOLTZ_DIR)) {
    mkdirSync(VOLTZ_DIR, { recursive: true, mode: 0o700 });
  } else {
    try { chmodSync(VOLTZ_DIR, 0o700); } catch { /* ignore */ }
  }
}

export function writePrivateFile(path: string, data: string): void {
  writeFileSync(path, data);
  chmodSync(path, 0o600);
}

function mergeConfigValues<T extends Record<string, unknown>>(
  existing: T,
  updates: Partial<T>
): T {
  const merged = { ...existing } as T;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete merged[key as keyof T];
    } else {
      merged[key as keyof T] = value as T[keyof T];
    }
  }
  return merged;
}

let cachedConfig: VoltzConfig | null | undefined = undefined;

export function invalidateConfigCache(): void {
  cachedConfig = undefined;
}

function loadJsonFile(path: string): Partial<VoltzConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function sanitizeConfig(raw: Partial<VoltzConfig>): VoltzConfig {
  const sanitized: Partial<VoltzConfig> = {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
  };

  for (const [key, schema] of Object.entries(VoltzConfigFields)) {
    const value = raw[key as keyof typeof raw];
    if (value === undefined) continue;
    const parsed = (schema as z.ZodTypeAny).safeParse(value);
    if (parsed.success) {
      (sanitized as Record<string, unknown>)[key] = parsed.data;
    }
  }

  return sanitized as VoltzConfig;
}

/**
 * Load config with two-tier override:
 *   config.json (shared/committed) ← config.local.json (personal overrides)
 *
 * Fields from local override merge on top of base, field by field.
 */
export function loadConfig(): VoltzConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const base = loadJsonFile(CONFIG_PATH);
  const local = loadJsonFile(CONFIG_LOCAL_PATH);

  if (!base && !local) {
    cachedConfig = null;
    return null;
  }

  const merged = { apiKey: "", ...base, ...local };
  const result = VoltzConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    console.error(`[voltz] Config validation warnings: ${issues.join(", ")}`);
    cachedConfig = sanitizeConfig(merged);
  } else {
    cachedConfig = result.data as VoltzConfig;
  }
  return cachedConfig;
}

export function saveConfig(config: Partial<VoltzConfig>): void {
  ensureVoltzDir();
  const existing = loadJsonFile(CONFIG_PATH) ?? {};
  const merged = mergeConfigValues(existing, config);
  writePrivateFile(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
  invalidateConfigCache();
}

function isProviderName(value: string | undefined): value is ProviderName {
  return value !== undefined && SUPPORTED_PROVIDERS.includes(value as ProviderName);
}

export function resolveProvider(config: VoltzConfig | null = loadConfig()): ProviderName {
  const envProvider = process.env.VOLTZ_PROVIDER;
  if (isProviderName(envProvider)) {
    return envProvider;
  }
  if (config?.provider && isProviderName(config.provider)) {
    return config.provider;
  }
  return DEFAULT_PROVIDER;
}

export interface ProviderSettings {
  provider: ProviderName;
  apiKey?: string;
  model: string;
  baseURL?: string;
}

export interface ResolvedProviderConfig extends ProviderSettings {
  apiKey: string;
}

export interface SessionState {
  sessionId?: string;
  messages?: Record<string, unknown>[];
}

export function getProviderLabel(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai-compatible":
      return "OpenAI-compatible";
  }
}

export function getProviderEnvHints(provider: ProviderName): string[] {
  switch (provider) {
    case "anthropic":
      return ["VOLTZ_API_KEY", "ANTHROPIC_API_KEY"];
    case "openai-compatible":
      return ["VOLTZ_API_KEY", "OPENAI_API_KEY"];
  }
}

export function getDefaultModel(provider: ProviderName): string {
  return DEFAULT_MODELS[provider];
}

export function getDefaultBaseURL(provider: ProviderName): string | undefined {
  if (provider === "openai-compatible") {
    return DEFAULT_OPENAI_BASE_URL;
  }
  return undefined;
}

function getApiKeyFromEnv(provider: ProviderName): string | undefined {
  if (process.env.VOLTZ_API_KEY) return process.env.VOLTZ_API_KEY;
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (provider === "openai-compatible" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  return undefined;
}

function getBaseURLFromEnv(provider: ProviderName): string | undefined {
  if (process.env.VOLTZ_BASE_URL) return process.env.VOLTZ_BASE_URL;
  if (provider === "openai-compatible" && process.env.OPENAI_BASE_URL) {
    return process.env.OPENAI_BASE_URL;
  }
  return undefined;
}

export function getProviderSettings(config: VoltzConfig | null = loadConfig()): ProviderSettings {
  const provider = resolveProvider(config);
  return {
    provider,
    apiKey: getApiKeyFromEnv(provider) ?? config?.apiKey ?? undefined,
    model: process.env.VOLTZ_MODEL ?? config?.model ?? getDefaultModel(provider),
    baseURL:
      getBaseURLFromEnv(provider) ??
      config?.baseURL ??
      getDefaultBaseURL(provider),
  };
}

export function resolveProviderConfig(
  config: VoltzConfig | null = loadConfig()
): ResolvedProviderConfig {
  const settings = getProviderSettings(config);
  if (!settings.apiKey) {
    const hints = getProviderEnvHints(settings.provider).join(" or ");
    throw new Error(
      `No API key found for ${getProviderLabel(settings.provider)}. Set ${hints}, or run: voltz setup`
    );
  }
  return {
    ...settings,
    apiKey: settings.apiKey,
  };
}

export function loadSessionState(
  provider = resolveProvider()
): SessionState | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as {
      provider?: string;
      sessionId?: unknown;
      messages?: unknown;
    };
    if (data.provider && data.provider !== provider) {
      return null;
    }
    const state: SessionState = {};
    if (typeof data.sessionId === "string" && data.sessionId) {
      state.sessionId = data.sessionId;
    }
    if (Array.isArray(data.messages)) {
      state.messages = data.messages.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
      );
    }
    return state.sessionId || state.messages ? state : null;
  } catch {
    return null;
  }
}

export function saveSessionState(
  state: SessionState,
  provider = resolveProvider()
): void {
  ensureVoltzDir();
  writePrivateFile(
    SESSION_PATH,
    JSON.stringify({ provider, ...state }, null, 2) + "\n"
  );
}
