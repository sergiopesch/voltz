import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the config module by mocking file paths
const TEST_DIR = join(tmpdir(), `voltz-config-test-${Date.now()}`);

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    VOLTZ_DIR: TEST_DIR,
    CONFIG_PATH: join(TEST_DIR, "config.json"),
    CONFIG_LOCAL_PATH: join(TEST_DIR, "config.local.json"),
    SESSION_PATH: join(TEST_DIR, "session.json"),
  };
});

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VOLTZ_PROVIDER;
    delete process.env.VOLTZ_API_KEY;
    delete process.env.VOLTZ_MODEL;
    delete process.env.VOLTZ_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    vi.resetModules();
  });

  describe("VoltzConfigSchema", () => {
    it("validates a correct config", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({
        apiKey: "sk-test-key-12345",
        ttsVoice: "Samantha",
        silenceTimeout: 2,
        maxDuration: 60,
        logLevel: "debug",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid silenceTimeout", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({
        apiKey: "sk-test",
        silenceTimeout: 100,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid logLevel", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({
        apiKey: "sk-test",
        logLevel: "verbose",
      });
      expect(result.success).toBe(false);
    });

    it("provides defaults for apiKey", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiKey).toBe("");
      }
    });

    it("accepts optional fields as undefined", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({
        apiKey: "sk-test",
        provider: "anthropic",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ttsVoice).toBeUndefined();
        expect(result.data.dangerousTools).toBeUndefined();
      }
    });

    it("accepts provider and baseURL", async () => {
      const { VoltzConfigSchema } = await import("../config.js");
      const result = VoltzConfigSchema.safeParse({
        provider: "openai-compatible",
        baseURL: "https://example.com/v1",
        apiKey: "sk-test",
        micDevice: "pulse:default",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("writePrivateFile", () => {
    it("creates a file with 0600 permissions", async () => {
      const { writePrivateFile } = await import("../config.js");
      const testFile = join(TEST_DIR, "private.txt");
      writePrivateFile(testFile, "secret data");
      expect(existsSync(testFile)).toBe(true);
      const { statSync } = await import("node:fs");
      const stat = statSync(testFile);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("provider resolution", () => {
    it("defaults to anthropic", async () => {
      const { resolveProvider } = await import("../config.js");
      expect(resolveProvider(null)).toBe("anthropic");
    });

    it("builds openai-compatible settings with defaults", async () => {
      const { getProviderSettings } = await import("../config.js");
      const settings = getProviderSettings({
        apiKey: "sk-test",
        provider: "openai-compatible",
      });
      expect(settings.provider).toBe("openai-compatible");
      expect(settings.model).toBeTruthy();
      expect(settings.baseURL).toBe("https://api.openai.com/v1");
    });

    it("prefers environment overrides", async () => {
      process.env.VOLTZ_PROVIDER = "openai-compatible";
      process.env.OPENAI_API_KEY = "env-key";
      process.env.VOLTZ_MODEL = "gpt-test";
      process.env.OPENAI_BASE_URL = "https://gateway.example/v1";

      const { getProviderSettings } = await import("../config.js");
      const settings = getProviderSettings({
        apiKey: "config-key",
        provider: "anthropic",
        model: "config-model",
      });

      expect(settings.provider).toBe("openai-compatible");
      expect(settings.apiKey).toBe("env-key");
      expect(settings.model).toBe("gpt-test");
      expect(settings.baseURL).toBe("https://gateway.example/v1");
    });
  });

  describe("config loading and persistence", () => {
    it("drops invalid typed fields instead of returning them raw", async () => {
      const { sanitizeConfig } = await import("../config.js");
      const config = sanitizeConfig({
          apiKey: "sk-test",
          provider: "not-a-provider",
          dangerousTools: "yes",
          logLevel: "noisy",
          ttsVoice: "Samantha",
          micDevice: 1234,
        } as unknown as Parameters<typeof sanitizeConfig>[0]);

      expect(config?.apiKey).toBe("sk-test");
      expect(config?.ttsVoice).toBe("Samantha");
      expect(config?.provider).toBeUndefined();
      expect(config?.dangerousTools).toBeUndefined();
      expect(config?.logLevel).toBeUndefined();
      expect(config?.micDevice).toBeUndefined();
    });

    it("removes baseURL when saving undefined", async () => {
      const { saveConfig, loadConfig, invalidateConfigCache } = await import("../config.js");

      saveConfig({
        provider: "openai-compatible",
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
      });
      saveConfig({
        provider: "anthropic",
        baseURL: undefined,
      });

      invalidateConfigCache();
      const config = loadConfig();
      expect(config?.provider).toBe("anthropic");
      expect(config?.baseURL).toBeUndefined();
    });
  });
});
