import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadSessionId, saveSessionId } from "../config.js";
import { getSystemPrompt } from "./system-prompt.js";
import { logger } from "../logger.js";
import { checkRateLimit } from "../rate-limit.js";
import { streamAnthropicDirect } from "./providers.js";

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

const ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
];

// --- Main streaming query ---

export async function* streamQuery(
  prompt: string,
  options?: { imageBase64?: string }
): AsyncGenerator<
  { type: "text"; text: string } | { type: "done"; sessionId: string }
> {
  // Rate limit check
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    yield { type: "text", text: rateCheck.reason ?? "Rate limit exceeded." };
    yield { type: "done", sessionId: "" };
    return;
  }

  const previousSessionId = loadSessionId();
  let fullPrompt: string;
  if (options?.imageBase64) {
    fullPrompt =
      prompt || "What do you see? Describe the components and any issues.";
  } else {
    fullPrompt = prompt;
  }

  let sessionId = previousSessionId ?? undefined;
  let resultText = "";
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
      resultText = "";

      for await (const message of query({
        prompt: fullPrompt,
        options: {
          systemPrompt: getSystemPrompt(),
          resume: sessionId,
          allowedTools: ALLOWED_TOOLS,
          permissionMode: "bypassPermissions" as const,
          allowDangerouslySkipPermissions: true,
        },
      })) {
        if (message.type === "system" && message.subtype === "init") {
          sessionId = message.session_id;
        }

        if (message.type === "assistant" && "message" in message) {
          const content = (
            message as {
              message: {
                content: Array<{ type: string; text?: string }>;
              };
            }
          ).message.content;
          for (const block of content) {
            if (block.type === "text" && block.text) {
              yield { type: "text", text: block.text };
              resultText += block.text;
            }
          }
        }

        if (message.type === "result") {
          const result = (message as { result?: string }).result;
          if (result && !resultText) {
            yield { type: "text", text: result };
          }
        }
      }

      // Success — save session and return
      const elapsed = Date.now() - startTime;
      logger.info("session", "query-done", {
        attempt,
        elapsed,
        resultLength: resultText.length,
      });

      if (sessionId) {
        saveSessionId(sessionId);
        yield { type: "done", sessionId };
      }
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("session", "query-error", { attempt, error: msg });

      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
        break;
      }
    }
  }

  // All retries exhausted with Agent SDK — try direct Anthropic API fallback
  logger.warn("session", "falling-back-to-direct-api");
  try {
    for await (const chunk of streamAnthropicDirect(fullPrompt)) {
      if (chunk.type === "text") {
        yield { type: "text", text: chunk.text };
      }
    }
    yield { type: "done", sessionId: sessionId ?? "" };
    return;
  } catch (fallbackErr) {
    const fbMsg =
      fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    logger.error("session", "fallback-failed", { error: fbMsg });
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
