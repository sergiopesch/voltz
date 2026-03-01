import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { STT_BINARY } from "../config.js";
import { registerSTT, type STTEngine } from "./registry.js";

interface STTResult {
  text: string | null;
  final: boolean;
}

interface STTStatus {
  status: string;
}

interface STTError {
  error: string;
}

export async function listen(options?: {
  silence?: number;
  maxDuration?: number;
}): Promise<string | null> {
  if (!existsSync(STT_BINARY)) {
    throw new Error(
      `STT binary not found at ${STT_BINARY}. Run: npm run postinstall`
    );
  }

  const args: string[] = [];
  if (options?.silence) args.push("--silence", String(options.silence));
  if (options?.maxDuration)
    args.push("--max-duration", String(options.maxDuration));

  return new Promise((resolve, reject) => {
    const proc = spawn(STT_BINARY, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const lines = stdout.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as STTResult | STTStatus | STTError;
          if ("error" in parsed) {
            reject(new Error(parsed.error));
            return;
          }
          if ("text" in parsed && parsed.final) {
            resolve(parsed.text);
            return;
          }
        } catch {
          // skip non-JSON lines
        }
      }

      if (code !== 0) {
        reject(new Error(`STT exited with code ${code}: ${stderr}`));
        return;
      }

      resolve(null);
    });

    proc.on("error", reject);
  });
}

// --- Register as an engine ---

class AppleSTTEngine implements STTEngine {
  readonly name = "apple-speech";

  async isAvailable(): Promise<boolean> {
    return process.platform === "darwin" && existsSync(STT_BINARY);
  }

  listen(options?: { silence?: number; maxDuration?: number }): Promise<string | null> {
    return listen(options);
  }
}

registerSTT("apple-speech", () => new AppleSTTEngine());
