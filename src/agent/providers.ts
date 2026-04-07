import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  getProviderLabel,
  resolveProviderConfig,
  type SessionState,
  type ProviderName,
  type ResolvedProviderConfig,
} from "../config.js";
import { getSystemPrompt } from "./system-prompt.js";
import { logger } from "../logger.js";
import {
  executeLocalToolCall,
  getOpenAICompatibleToolDefinitions,
  type ToolDefinition,
} from "./tool-runtime.js";

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "session"; sessionId: string }
  | { type: "state"; state: SessionState }
  | { type: "done" };

export interface ProviderStreamOptions {
  prompt: string;
  imageBase64?: string;
  resumeSessionId?: string;
  resumeState?: SessionState | null;
  allowedTools?: string[];
  dangerousTools?: boolean;
}

export interface ProviderAdapter {
  name: ProviderName;
  capabilities: {
    toolUse: boolean;
    vision: boolean;
    sessionResume: boolean;
  };
  stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk>;
  testConnection(): Promise<void>;
}

export function createProviderAdapter(
  config: ResolvedProviderConfig = resolveProviderConfig()
): ProviderAdapter {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAdapter(config);
    case "openai-compatible":
      return createOpenAICompatibleAdapter(config);
  }
}

function createAnthropicAdapter(config: ResolvedProviderConfig): ProviderAdapter {
  return {
    name: "anthropic",
    capabilities: {
      toolUse: true,
      vision: true,
      sessionResume: true,
    },
    async *stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
      if (options.imageBase64) {
        yield* streamAnthropicMessages(config, options.prompt, options.imageBase64);
        return;
      }

      try {
        yield* streamAnthropicAgent(config, options);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("provider", "anthropic-agent-fallback", {
          provider: config.provider,
          error: message,
        });
        yield* streamAnthropicMessages(config, options.prompt);
      }
    },
    async testConnection(): Promise<void> {
      const client = new Anthropic({ apiKey: config.apiKey });
      await client.messages.create({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
    },
  };
}

async function* streamAnthropicAgent(
  config: ResolvedProviderConfig,
  options: ProviderStreamOptions
): AsyncGenerator<StreamChunk> {
  let emittedText = false;

  for await (const message of query({
    prompt: options.prompt,
    options: {
      systemPrompt: getSystemPrompt(),
      resume: options.resumeSessionId,
      allowedTools: options.allowedTools,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      yield { type: "session", sessionId: message.session_id };
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
          emittedText = true;
          yield { type: "text", text: block.text };
        }
      }
    }

    if (message.type === "result") {
      const result = (message as { result?: string }).result;
      if (result && !emittedText) {
        emittedText = true;
        yield { type: "text", text: result };
      }
    }
  }

  logger.info("provider", "anthropic-agent-done", {
    provider: config.provider,
    model: config.model,
  });
  yield { type: "done" };
}

async function* streamAnthropicMessages(
  config: ResolvedProviderConfig,
  prompt: string,
  imageBase64?: string
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey: config.apiKey });

  logger.info("provider", "anthropic-messages-start", {
    model: config.model,
    hasImage: !!imageBase64,
  });

  const userContent: Anthropic.MessageCreateParams["messages"][0]["content"] =
    imageBase64
      ? [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data: imageBase64,
            },
          },
          { type: "text" as const, text: prompt },
        ]
      : prompt;

  const stream = client.messages.stream({
    model: config.model,
    max_tokens: 1024,
    system: getSystemPrompt(),
    messages: [{ role: "user", content: userContent }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }

  logger.info("provider", "anthropic-messages-done", {
    model: config.model,
  });
  yield { type: "done" };
}

function createOpenAICompatibleAdapter(
  config: ResolvedProviderConfig
): ProviderAdapter {
  const baseURL = config.baseURL ?? "https://api.openai.com/v1";

  return {
    name: "openai-compatible",
    capabilities: {
      toolUse: true,
      vision: true,
      sessionResume: true,
    },
    async *stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
      yield* runOpenAICompatibleConversation(config, {
        ...options,
        baseURL,
      });
    },
    async testConnection(): Promise<void> {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `${getProviderLabel(config.provider)} API error ${response.status}: ${body.slice(0, 200)}`
        );
      }
    },
  };
}

async function* runOpenAICompatibleConversation(
  config: ResolvedProviderConfig,
  options: ProviderStreamOptions & {
    baseURL: string;
  }
): AsyncGenerator<StreamChunk> {
  const workingMessages = Array.isArray(options.resumeState?.messages)
    ? [...options.resumeState.messages]
    : [];

  const userMessage = createOpenAIUserMessage(options.prompt, options.imageBase64);
  workingMessages.push(userMessage);

  const tools = getOpenAICompatibleToolDefinitions(
    !!options.dangerousTools,
    options.allowedTools
  );
  const allowTools = tools.length > 0;

  for (let step = 0; step < 8; step++) {
    const response = await requestOpenAICompatibleCompletion({
      apiKey: config.apiKey,
      baseURL: options.baseURL,
      model: config.model,
      messages: buildOpenAIConversationMessages(workingMessages),
      tools: allowTools ? tools : undefined,
    });

    const assistantMessage = extractOpenAICompatibleAssistantMessage(response);
    if (!assistantMessage) {
      break;
    }

    workingMessages.push(assistantMessage);

    const toolCalls = Array.isArray(assistantMessage.tool_calls)
      ? assistantMessage.tool_calls
      : [];

    if (allowTools && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const toolName =
          typeof toolCall === "object" &&
          toolCall !== null &&
          "function" in toolCall &&
          typeof toolCall.function === "object" &&
          toolCall.function !== null &&
          "name" in toolCall.function &&
          typeof toolCall.function.name === "string"
            ? toolCall.function.name
            : "";
        const toolArgs =
          typeof toolCall === "object" &&
          toolCall !== null &&
          "function" in toolCall &&
          typeof toolCall.function === "object" &&
          toolCall.function !== null &&
          "arguments" in toolCall.function
            ? toolCall.function.arguments
            : undefined;
        const toolCallId =
          typeof toolCall === "object" &&
          toolCall !== null &&
          "id" in toolCall &&
          typeof toolCall.id === "string"
            ? toolCall.id
            : "";

        const result = await executeLocalToolCall(toolName, toolArgs, {
          dangerousTools: !!options.dangerousTools,
          cwd: process.cwd(),
          allowedTools: options.allowedTools,
        });

        workingMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: result,
        });
      }
      continue;
    }

    const content = extractOpenAICompatibleContent(assistantMessage.content);
    if (content) {
      yield { type: "text", text: content };
    }
    break;
  }

  yield {
    type: "state",
    state: {
      messages: trimConversationHistory(workingMessages),
    },
  };
  yield { type: "done" };
}

function extractOpenAICompatibleContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }
      return [];
    })
    .join("");
}

async function requestOpenAICompatibleCompletion(options: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: Array<{ role: string; content: unknown; [key: string]: unknown }>;
  tools?: Array<{ type: "function"; function: ToolDefinition }>;
}): Promise<unknown> {
  const response = await fetch(`${options.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 1024,
      messages: options.messages,
      ...(options.tools ? { tools: options.tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI-compatible API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  return response.json();
}

function extractOpenAICompatibleAssistantMessage(
  parsed: unknown
): Record<string, unknown> | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as { choices?: Array<{ message?: unknown }> }).choices;
  const message = choices?.[0]?.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return null;
  }
  return message as Record<string, unknown>;
}

function createOpenAIUserMessage(
  prompt: string,
  imageBase64?: string
): Record<string, unknown> {
  const content = imageBase64
    ? [
        {
          type: "text",
          text: prompt,
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`,
          },
        },
      ]
    : prompt;

  return {
    role: "user",
    content,
  };
}

function buildOpenAIConversationMessages(
  messages: Record<string, unknown>[]
): Array<{ role: string; content: unknown; [key: string]: unknown }> {
  return [{ role: "system", content: getSystemPrompt() }, ...messages].map(
    (message) => ({
      ...message,
      role: typeof message.role === "string" ? message.role : "user",
      content: "content" in message ? message.content : "",
    })
  );
}

function trimConversationHistory(
  messages: Record<string, unknown>[]
): Record<string, unknown>[] {
  const maxMessages = 24;
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}
