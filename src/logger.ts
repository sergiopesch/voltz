import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { VOLTZ_DIR, ensureVoltzDir } from "./config.js";

const LOGS_DIR = join(VOLTZ_DIR, "logs");
const LOG_FILE = join(LOGS_DIR, "voltz.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  session?: string;
  [key: string]: unknown;
}

// Buffer log lines and flush periodically for performance
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 500;
const BUFFER_MAX = 50;

let currentSession: string | undefined;
let minLevel: LogLevel = "info";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function ensureLogDir(): void {
  ensureVoltzDir();
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const { size } = statSync(LOG_FILE);
    if (size > MAX_LOG_SIZE) {
      renameSync(LOG_FILE, LOG_FILE + ".1");
    }
  } catch {
    // ignore rotation errors
  }
}

function flushBuffer(): void {
  if (buffer.length === 0) return;
  try {
    ensureLogDir();
    rotateIfNeeded();
    appendFileSync(LOG_FILE, buffer.join(""));
    buffer = [];
  } catch {
    buffer = []; // drop rather than leak memory
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

function write(entry: LogEntry): void {
  buffer.push(JSON.stringify(entry) + "\n");
  if (buffer.length >= BUFFER_MAX) {
    flushBuffer();
  } else {
    scheduleFlush();
  }
}

export function setSession(sessionId: string): void {
  currentSession = sessionId;
}

export function setLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function log(
  level: LogLevel,
  component: string,
  msg: string,
  extra?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(currentSession ? { session: currentSession } : {}),
    ...extra,
  };

  write(entry);
}

export const logger = {
  debug: (component: string, msg: string, extra?: Record<string, unknown>) =>
    log("debug", component, msg, extra),

  info: (component: string, msg: string, extra?: Record<string, unknown>) =>
    log("info", component, msg, extra),

  warn: (component: string, msg: string, extra?: Record<string, unknown>) =>
    log("warn", component, msg, extra),

  error: (component: string, msg: string, extra?: Record<string, unknown>) =>
    log("error", component, msg, extra),

  /** Flush buffered logs to disk immediately */
  flush: flushBuffer,
};

// Flush on process exit
process.on("exit", flushBuffer);
process.on("SIGINT", () => {
  flushBuffer();
  process.exit(0);
});
