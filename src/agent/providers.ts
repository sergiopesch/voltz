import Anthropic from "@anthropic-ai/sdk";
import { getApiKey, loadConfig } from "../config.js";
import { getSystemPrompt } from "./system-prompt.js";
import { logger } from "../logger.js";

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "done" };

/**
 * Direct Anthropic Messages API fallback.
 * Used when Claude Agent SDK is unavailable or for simpler queries.
 * No tools, no session management — just streaming text.
 */
export async function* streamAnthropicDirect(
  prompt: string
): AsyncGenerator<StreamChunk> {
  const apiKey = getApiKey();
  const config = loadConfig();
  const model = (config as Record<string, unknown> | null)?.model as string | undefined ?? "claude-sonnet-4-5-20250514";

  const client = new Anthropic({ apiKey });

  logger.info("provider", "anthropic-direct-start", { model });

  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: getSystemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }

  logger.info("provider", "anthropic-direct-done");
  yield { type: "done" };
}

/**
 * OpenAI-compatible endpoint fallback.
 * Works with OpenAI, OpenRouter, Ollama, and any compatible API.
 */
export async function* streamOpenAICompatible(
  prompt: string,
  options: {
    apiKey: string;
    baseURL: string;
    model: string;
    extraHeaders?: Record<string, string>;
  }
): AsyncGenerator<StreamChunk> {
  logger.info("provider", "openai-compat-start", {
    model: options.model,
    baseURL: options.baseURL,
  });

  const response = await fetch(`${options.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
      ...options.extraHeaders,
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      max_tokens: 1024,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI-compatible API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        yield { type: "done" };
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield { type: "text", text: content };
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  logger.info("provider", "openai-compat-done");
  yield { type: "done" };
}
