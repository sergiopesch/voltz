import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { registerTTS, type TTSEngine } from "./registry.js";
import { loadConfig } from "../config.js";

export const SENTENCE_ENDINGS = /(?<=[.!?])\s+/;
const ESPEAK_BINARIES = ["espeak-ng", "espeak"] as const;

interface SpeechCommand {
  cmd: string;
  args: string[];
}

export function stripMarkdown(text: string): string {
  return (
    text
      // Code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Inline code
      .replace(/`([^`]+)`/g, "$1")
      // Bold/italic
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Headers
      .replace(/^#{1,6}\s+/gm, "")
      // Links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Bullet points
      .replace(/^[-*+]\s+/gm, "")
      // Numbered lists
      .replace(/^\d+\.\s+/gm, "")
      // Extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export class TTS {
  private buffer = "";
  private currentProcess: ChildProcess | null = null;
  private speaking = false;
  private queue: string[] = [];
  private flushResolve: (() => void) | null = null;
  private readonly buildCommand: (text: string) => SpeechCommand;

  constructor(buildCommand: (text: string) => SpeechCommand) {
    this.buildCommand = buildCommand;
  }

  feedText(chunk: string): void {
    this.buffer += chunk;

    const parts = this.buffer.split(SENTENCE_ENDINGS);
    if (parts.length > 1) {
      // Queue all complete sentences
      for (let i = 0; i < parts.length - 1; i++) {
        const sentence = parts[i].trim();
        if (sentence) {
          this.queue.push(sentence);
        }
      }
      // Keep the incomplete part in the buffer
      this.buffer = parts[parts.length - 1];

      // Start speaking if not already
      if (!this.speaking) {
        this.speakNext();
      }
    }
  }

  flush(): Promise<void> {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining) {
      this.queue.push(remaining);
    }
    if (!this.speaking && this.queue.length === 0) {
      return Promise.resolve();
    }
    if (!this.speaking) {
      this.speakNext();
    }
    return new Promise((resolve) => {
      this.flushResolve = resolve;
    });
  }

  stopSpeaking(): void {
    this.queue = [];
    this.buffer = "";
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    this.speaking = false;
    this.flushResolve?.();
    this.flushResolve = null;
  }

  private speakNext(): void {
    const text = this.queue.shift();
    if (!text) {
      this.speaking = false;
      this.flushResolve?.();
      this.flushResolve = null;
      return;
    }

    this.speaking = true;
    const cleaned = stripMarkdown(text);
    if (!cleaned) {
      this.speakNext();
      return;
    }

    const command = this.buildCommand(cleaned);

    this.currentProcess = spawn(command.cmd, command.args, {
      stdio: "ignore",
      signal: AbortSignal.timeout(30_000),
    });

    this.currentProcess.on("close", () => {
      this.currentProcess = null;
      this.speakNext();
    });

    this.currentProcess.on("error", () => {
      this.currentProcess = null;
      this.speakNext();
    });
  }
}

// --- Register as an engine ---

class AppleTTSEngine implements TTSEngine {
  readonly name = "apple-say";
  private tts: TTS;

  constructor() {
    const config = loadConfig();
    this.tts = new TTS((text) => ({
      cmd: "say",
      args: ["-v", config?.ttsVoice ?? "Samantha", text],
    }));
  }

  async isAvailable(): Promise<boolean> {
    return process.platform === "darwin";
  }

  feedText(chunk: string): void {
    this.tts.feedText(chunk);
  }

  flush(): Promise<void> {
    return this.tts.flush();
  }

  stop(): void {
    this.tts.stopSpeaking();
  }
}

registerTTS("apple-say", () => new AppleTTSEngine());

class LinuxTTSEngine implements TTSEngine {
  readonly name = "linux-espeak";
  private readonly binary = findEspeakBinary();
  private readonly tts: TTS;

  constructor() {
    const config = loadConfig();
    const voice = config?.ttsVoice ?? "en";
    const binary = this.binary ?? "espeak";
    this.tts = new TTS((text) => ({
      cmd: binary,
      args: ["-v", voice, text],
    }));
  }

  async isAvailable(): Promise<boolean> {
    return process.platform === "linux" && this.binary !== null;
  }

  feedText(chunk: string): void {
    this.tts.feedText(chunk);
  }

  flush(): Promise<void> {
    return this.tts.flush();
  }

  stop(): void {
    this.tts.stopSpeaking();
  }
}

registerTTS("linux-espeak", () => new LinuxTTSEngine());

function findEspeakBinary(): string | null {
  for (const candidate of ESPEAK_BINARIES) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error) {
      return candidate;
    }
  }
  return null;
}
