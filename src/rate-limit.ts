import { existsSync } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { VOLTZ_DIR, ensureVoltzDir, loadConfig } from "./config.js";
import { logger } from "./logger.js";

const RATE_FILE = join(VOLTZ_DIR, "rate-limit.json");

interface RateData {
  hourly: { count: number; resetAt: number };
  daily: { count: number; resetAt: number };
}

const DEFAULTS = {
  maxPerHour: 60,
  maxPerDay: 500,
};

async function load(): Promise<RateData> {
  if (!existsSync(RATE_FILE)) {
    return freshData();
  }
  try {
    const data = await readFile(RATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return freshData();
  }
}

function freshData(): RateData {
  const now = Date.now();
  return {
    hourly: { count: 0, resetAt: now + 3600_000 },
    daily: { count: 0, resetAt: now + 86400_000 },
  };
}

async function save(data: RateData): Promise<void> {
  ensureVoltzDir();
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(RATE_FILE, content);
  await chmod(RATE_FILE, 0o600);
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  hourlyRemaining: number;
  dailyRemaining: number;
}

/**
 * Check and consume a rate limit token.
 * Returns allowed: true if under limits, false with reason if exceeded.
 */
export async function checkRateLimit(): Promise<RateLimitResult> {
  const config = loadConfig();
  const maxHour = config?.maxPerHour ?? DEFAULTS.maxPerHour;
  const maxDay = config?.maxPerDay ?? DEFAULTS.maxPerDay;

  const data = await load();
  const now = Date.now();

  // Reset expired windows
  if (now >= data.hourly.resetAt) {
    data.hourly = { count: 0, resetAt: now + 3600_000 };
  }
  if (now >= data.daily.resetAt) {
    data.daily = { count: 0, resetAt: now + 86400_000 };
  }

  const hourlyRemaining = Math.max(0, maxHour - data.hourly.count);
  const dailyRemaining = Math.max(0, maxDay - data.daily.count);

  // Check limits
  if (data.hourly.count >= maxHour) {
    const resetIn = Math.ceil((data.hourly.resetAt - now) / 60_000);
    const reason = `Hourly limit reached (${maxHour}/hour). Resets in ${resetIn} minutes.`;
    logger.warn("rate-limit", "hourly-exceeded", { count: data.hourly.count, max: maxHour });
    await save(data);
    return { allowed: false, reason, hourlyRemaining: 0, dailyRemaining };
  }

  if (data.daily.count >= maxDay) {
    const resetIn = Math.ceil((data.daily.resetAt - now) / 3600_000);
    const reason = `Daily limit reached (${maxDay}/day). Resets in ${resetIn} hours.`;
    logger.warn("rate-limit", "daily-exceeded", { count: data.daily.count, max: maxDay });
    await save(data);
    return { allowed: false, reason, hourlyRemaining, dailyRemaining: 0 };
  }

  // Consume token
  data.hourly.count++;
  data.daily.count++;
  await save(data);

  return {
    allowed: true,
    hourlyRemaining: maxHour - data.hourly.count,
    dailyRemaining: maxDay - data.daily.count,
  };
}

/** Get current usage without consuming a token */
export async function getRateLimitStatus(): Promise<{ hourly: number; daily: number; maxHour: number; maxDay: number }> {
  const config = loadConfig();
  const maxHour = config?.maxPerHour ?? DEFAULTS.maxPerHour;
  const maxDay = config?.maxPerDay ?? DEFAULTS.maxPerDay;
  const data = await load();
  const now = Date.now();

  return {
    hourly: now >= data.hourly.resetAt ? 0 : data.hourly.count,
    daily: now >= data.daily.resetAt ? 0 : data.daily.count,
    maxHour,
    maxDay,
  };
}
