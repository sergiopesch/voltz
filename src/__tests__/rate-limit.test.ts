import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `voltz-rate-test-${Date.now()}`);
const RATE_FILE = join(TEST_DIR, "rate-limit.json");

// Mock config to use test directory
vi.mock("../config.js", () => ({
  VOLTZ_DIR: TEST_DIR,
  ensureVoltzDir: () => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  },
  loadConfig: () => null,
  writePrivateFile: (path: string, data: string) => writeFileSync(path, data),
}));

// Override the RATE_FILE path in rate-limit
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    join: (...args: string[]) => {
      const result = actual.join(...args);
      if (result.endsWith("rate-limit.json") && result.includes(".voltz")) {
        return RATE_FILE;
      }
      return result;
    },
  };
});

describe("rate-limit", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("allows requests under the limit", async () => {
    const { checkRateLimit } = await import("../rate-limit.js");
    const result = await checkRateLimit();
    expect(result.allowed).toBe(true);
    expect(result.hourlyRemaining).toBeLessThanOrEqual(60);
  });

  it("tracks hourly and daily counts", async () => {
    const { checkRateLimit } = await import("../rate-limit.js");
    const r1 = await checkRateLimit();
    expect(r1.allowed).toBe(true);
    expect(r1.dailyRemaining).toBeGreaterThan(0);
  });

  it("getRateLimitStatus returns current state", async () => {
    const { getRateLimitStatus, checkRateLimit } = await import("../rate-limit.js");
    await checkRateLimit(); // consume one token
    const status = await getRateLimitStatus();
    expect(status.hourly).toBeGreaterThanOrEqual(1);
    expect(status.daily).toBeGreaterThanOrEqual(1);
    expect(status.maxHour).toBe(60);
    expect(status.maxDay).toBe(500);
  });

  it("handles missing rate file gracefully", async () => {
    // Remove any existing file
    try { rmSync(RATE_FILE); } catch { /* ignore */ }
    const { checkRateLimit } = await import("../rate-limit.js");
    const result = await checkRateLimit();
    expect(result.allowed).toBe(true);
  });

  it("handles malformed rate file gracefully", async () => {
    writeFileSync(RATE_FILE, "not json!!");
    const { checkRateLimit } = await import("../rate-limit.js");
    const result = await checkRateLimit();
    expect(result.allowed).toBe(true);
  });
});
