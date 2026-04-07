import {
  loadSessionState,
  saveSessionState,
  loadConfig,
  resolveProviderConfig,
} from "../config.js";
import { logger } from "../logger.js";
import { checkRateLimit } from "../rate-limit.js";
import { createProviderAdapter } from "./providers.js";

export interface AgentResponse {
  text: string;
  sessionId: string;
}

// --- Retry with exponential backoff ---

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const BUDGET_CAP_MS = 45_000;

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Retry on rate limits, server errors, network errors
  return (
    /rate.?limit/i.test(msg) ||
    /5\d\d/.test(msg) ||
    /timeout/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ENOTFOUND/i.test(msg) ||
    /overloaded/i.test(msg)
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Agent SDK tools ---

function getAllowedTools(): string[] {
  const tools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
  const config = loadConfig();
  if (config?.dangerousTools) {
    tools.unshift("Bash");
  }
  return tools;
}

// --- Main streaming query ---

export async function* streamQuery(
  prompt: string,
  options?: { imageBase64?: string }
): AsyncGenerator<
  { type: "text"; text: string } | { type: "done"; sessionId: string }
> {
  // Rate limit check
  const rateCheck = await checkRateLimit();
  if (!rateCheck.allowed) {
    yield { type: "text", text: rateCheck.reason ?? "Rate limit exceeded." };
    yield { type: "done", sessionId: "" };
    return;
  }

  const providerConfig = resolveProviderConfig();
  const provider = providerConfig.provider;
  const adapter = createProviderAdapter(providerConfig);
  const previousState = adapter.capabilities.sessionResume
    ? loadSessionState(provider)
    : null;
  let fullPrompt: string;
  if (options?.imageBase64) {
    fullPrompt =
      prompt || "What do you see? Describe the components and any issues.";
  } else {
    fullPrompt = prompt;
  }

  if (options?.imageBase64 && !adapter.capabilities.vision) {
    throw new Error(`Provider ${provider} does not support vision input.`);
  }

  let sessionId = previousState?.sessionId;
  let nextState = previousState ?? undefined;
  let lastError: unknown;
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Budget cap: don't retry if we've spent too long already
    if (attempt > 0 && Date.now() - startTime > BUDGET_CAP_MS) {
      logger.warn("session", "retry-budget-exhausted", {
        attempt,
        elapsed: Date.now() - startTime,
      });
      break;
    }

    // Backoff delay on retry
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.info("session", "retry", { attempt, delay });
      await sleep(delay);
    }

    try {
      let resultText = "";

      for await (const chunk of adapter.stream({
        prompt: fullPrompt,
        imageBase64: options?.imageBase64,
        resumeSessionId: sessionId,
        resumeState: nextState ?? previousState,
        allowedTools: adapter.capabilities.toolUse ? getAllowedTools() : [],
        dangerousTools: !!loadConfig()?.dangerousTools,
      })) {
        if (chunk.type === "session") {
          sessionId = chunk.sessionId;
          nextState = { ...(nextState ?? {}), sessionId: chunk.sessionId };
        } else if (chunk.type === "state") {
          nextState = chunk.state;
          if (chunk.state.sessionId) {
            sessionId = chunk.state.sessionId;
          }
        } else if (chunk.type === "text") {
          yield { type: "text", text: chunk.text };
          resultText += chunk.text;
        }
      }

      // Success — save session and return
      const elapsed = Date.now() - startTime;
      logger.info("session", "query-done", {
        attempt,
        elapsed,
        resultLength: resultText.length,
        provider,
      });

      if (nextState) {
        saveSessionState(nextState, provider);
        yield { type: "done", sessionId: sessionId ?? "" };
      } else {
        yield { type: "done", sessionId: "" };
      }
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("session", "query-error", { attempt, error: msg, provider });

      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
        break;
      }
    }
  }

  // Everything failed — throw the original error
  throw lastError;
}

export async function sendQuery(
  prompt: string,
  options?: { imageBase64?: string }
): Promise<AgentResponse> {
  let fullText = "";
  let sessionId = "";

  for await (const chunk of streamQuery(prompt, options)) {
    if (chunk.type === "text") {
      fullText += chunk.text;
    } else if (chunk.type === "done") {
      sessionId = chunk.sessionId;
    }
  }

  return { text: fullText, sessionId };
}
