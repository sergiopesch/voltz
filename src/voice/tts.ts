import { spawn, type ChildProcess } from "node:child_process";
import { registerTTS, type TTSEngine } from "./registry.js";

const SENTENCE_ENDINGS = /(?<=[.!?])\s+/;

function stripMarkdown(text: string): string {
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

  async flush(): Promise<void> {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining) {
      this.queue.push(remaining);
      if (!this.speaking) {
        this.speakNext();
      }
    }

    // Wait for all speech to finish
    return new Promise((resolve) => {
      const check = () => {
        if (!this.speaking && this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
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
  }

  private speakNext(): void {
    const text = this.queue.shift();
    if (!text) {
      this.speaking = false;
      return;
    }

    this.speaking = true;
    const cleaned = stripMarkdown(text);
    if (!cleaned) {
      this.speakNext();
      return;
    }

    this.currentProcess = spawn("say", ["-v", "Samantha", cleaned], {
      stdio: "ignore",
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
  private tts = new TTS();

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
