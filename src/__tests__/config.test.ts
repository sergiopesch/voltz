import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ttsVoice).toBeUndefined();
        expect(result.data.dangerousTools).toBeUndefined();
      }
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
});
