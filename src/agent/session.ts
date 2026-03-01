import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadSessionId, saveSessionId } from "../config.js";
import { getSystemPrompt } from "./system-prompt.js";

export interface AgentResponse {
  text: string;
  sessionId: string;
}

export async function* streamQuery(
  prompt: string,
  options?: { imageBase64?: string }
): AsyncGenerator<{ type: "text"; text: string } | { type: "done"; sessionId: string }> {
  const previousSessionId = loadSessionId();

  let fullPrompt: string;
  if (options?.imageBase64) {
    fullPrompt = prompt || "What do you see? Describe the components and any issues.";
  } else {
    fullPrompt = prompt;
  }

  let sessionId = previousSessionId ?? undefined;
  let resultText = "";

  for await (const message of query({
    prompt: fullPrompt,
    options: {
      systemPrompt: getSystemPrompt(),
      resume: sessionId,
      allowedTools: [],
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
    }

    if (message.type === "assistant" && "message" in message) {
      const content = (message as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
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

  if (sessionId) {
    saveSessionId(sessionId);
    yield { type: "done", sessionId };
  }
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
