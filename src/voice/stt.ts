import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, STT_BINARY, type VoltzConfig } from "../config.js";
import { registerSTT, type STTEngine } from "./registry.js";

const WHISPER_BINARIES = ["whisper-cli"] as const;
const DEFAULT_LINUX_MODEL_CANDIDATES = [
  join(homedir(), ".cache", "whisper.cpp", "ggml-base.en.bin"),
  join(homedir(), ".local", "share", "whisper.cpp", "ggml-base.en.bin"),
  "/usr/local/share/whisper.cpp/ggml-base.en.bin",
  "/usr/share/whisper.cpp/ggml-base.en.bin",
] as const;
const DEFAULT_LINUX_MIC_DEVICE = "default";
const DEFAULT_LINUX_BACKEND_ORDER = ["pulse", "alsa"] as const;

export interface LinuxRecordingBackend {
  format: "pulse" | "alsa";
  device: string;
}

export interface LinuxSTTDiagnostics {
  ffmpegAvailable: boolean;
  whisperBinary: string | null;
  modelPath: string | null;
  micOverride: string | null;
  backends: LinuxRecordingBackend[];
}

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
  if (process.platform === "linux") {
    return listenLinux(options);
  }

  if (!existsSync(STT_BINARY)) {
    throw new Error(
      `STT binary not found at ${STT_BINARY}. Run: npm run postinstall`
    );
  }

  const args: string[] = [];
  if (options?.silence) args.push("--silence", String(options.silence));
  if (options?.maxDuration)
    args.push("--max-duration", String(options.maxDuration));

  const timeoutMs = ((options?.maxDuration ?? 30) + 30) * 1000; // maxDuration + 30s buffer
  return new Promise((resolve, reject) => {
    const proc = spawn(STT_BINARY, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(timeoutMs),
    });

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

async function listenLinux(options?: {
  silence?: number;
  maxDuration?: number;
}): Promise<string | null> {
  const diagnostics = getLinuxSTTDiagnostics();
  if (!diagnostics.ffmpegAvailable) {
    throw new Error(
      "ffmpeg not found. Install ffmpeg to enable Linux STT recording."
    );
  }

  if (!diagnostics.whisperBinary) {
    throw new Error(
      "No Linux STT backend found. Install whisper.cpp and make `whisper-cli` available in PATH."
    );
  }

  if (!diagnostics.modelPath) {
    throw new Error(
      "No STT model found. Set `sttModelPath` in config or `VOLTZ_STT_MODEL` in the environment."
    );
  }

  const audioPath = join(tmpdir(), `voltz-stt-${Date.now()}.wav`);

  try {
    const recorded = await recordLinuxAudio(audioPath, {
      silence: options?.silence ?? 1.5,
      maxDuration: options?.maxDuration ?? 30,
    });
    if (!recorded) return null;

    const transcript = await transcribeLinuxAudio(
      diagnostics.whisperBinary,
      diagnostics.modelPath,
      audioPath
    );
    return transcript || null;
  } finally {
    try {
      unlinkSync(audioPath);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

async function recordLinuxAudio(
  outputPath: string,
  options: { silence: number; maxDuration: number }
): Promise<boolean> {
  let lastError = "unknown recording error";

  for (const backend of getLinuxRecordingBackends()) {
    try {
      const recorded = await recordLinuxAudioWithBackend(outputPath, backend, options);
      if (recorded) {
        return true;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

async function recordLinuxAudioWithBackend(
  outputPath: string,
  backend: { format: string; device: string },
  options: { silence: number; maxDuration: number }
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "info",
      "-f",
      backend.format,
      "-i",
      backend.device,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-af",
      `silencedetect=n=-45dB:d=${options.silence}`,
      "-y",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let heardSpeech = false;
    let finished = false;
    let stderr = "";
    const timeout = setTimeout(() => {
      proc.kill("SIGINT");
    }, options.maxDuration * 1000);

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      for (const line of text.split("\n")) {
        if (!heardSpeech && line.includes("silence_end:")) {
          heardSpeech = true;
        } else if (heardSpeech && line.includes("silence_start:")) {
          proc.kill("SIGINT");
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("close", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (!existsSync(outputPath)) {
        reject(
          new Error(`ffmpeg recording failed with ${backend.format}: ${stderr}`)
        );
        return;
      }

      try {
        const size = statSync(outputPath).size;
        resolve(heardSpeech && size > 4096);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function transcribeLinuxAudio(
  whisperBinary: string,
  modelPath: string,
  audioPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const args = ["-m", modelPath, "-f", audioPath];
    if (config?.sttLanguage) {
      args.push("-l", config.sttLanguage);
    }

    const proc = spawn(whisperBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(120_000),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
        return;
      }

      const transcript = parseWhisperTranscript(stdout || stderr);
      resolve(transcript);
    });
  });
}

export function parseWhisperTranscript(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^whisper_/i.test(line) &&
        !/^system_info:/i.test(line) &&
        !/^main:/i.test(line)
    )
    .map((line) =>
      line.replace(/^\[[0-9:. ]+\-\->[0-9:. ]+\]\s*/g, "").trim()
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function commandExists(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error;
}

export function isFFmpegAvailable(): boolean {
  return commandExists("ffmpeg", ["-version"]);
}

export function findWhisperBinary(): string | null {
  for (const binary of WHISPER_BINARIES) {
    if (commandExists(binary, ["--help"])) return binary;
  }
  return null;
}

export function resolveLinuxModelPath(
  config: Pick<VoltzConfig, "sttModelPath"> | null = loadConfig()
): string | null {
  const candidates = [
    process.env.VOLTZ_STT_MODEL,
    config?.sttModelPath,
    ...DEFAULT_LINUX_MODEL_CANDIDATES,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveLinuxMicOverride(
  config: Pick<VoltzConfig, "micDevice"> | null = loadConfig()
): string | null {
  const candidate = process.env.VOLTZ_MIC_DEVICE ?? config?.micDevice ?? null;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : null;
}

export function buildLinuxRecordingBackends(
  micOverride: string | null
): LinuxRecordingBackend[] {
  if (!micOverride) {
    return DEFAULT_LINUX_BACKEND_ORDER.map((format) => ({
      format,
      device: DEFAULT_LINUX_MIC_DEVICE,
    }));
  }

  const match = micOverride.match(/^(pulse|alsa):(.*)$/i);
  if (match) {
    const format = match[1].toLowerCase() as LinuxRecordingBackend["format"];
    const device = match[2].trim() || DEFAULT_LINUX_MIC_DEVICE;
    return [{ format, device }];
  }

  return DEFAULT_LINUX_BACKEND_ORDER.map((format) => ({
    format,
    device: micOverride,
  }));
}

export function getLinuxRecordingBackends(
  config: Pick<VoltzConfig, "micDevice"> | null = loadConfig()
): LinuxRecordingBackend[] {
  return buildLinuxRecordingBackends(resolveLinuxMicOverride(config));
}

export function getLinuxSTTDiagnostics(
  config: Pick<VoltzConfig, "sttModelPath" | "micDevice"> | null = loadConfig()
): LinuxSTTDiagnostics {
  return {
    ffmpegAvailable: isFFmpegAvailable(),
    whisperBinary: findWhisperBinary(),
    modelPath: resolveLinuxModelPath(config),
    micOverride: resolveLinuxMicOverride(config),
    backends: getLinuxRecordingBackends(config),
  };
}

export function getLinuxSTTMissingRequirements(
  diagnostics: LinuxSTTDiagnostics
): string[] {
  const missing: string[] = [];
  if (!diagnostics.ffmpegAvailable) {
    missing.push("ffmpeg");
  }
  if (!diagnostics.whisperBinary) {
    missing.push("whisper-cli");
  }
  if (!diagnostics.modelPath) {
    missing.push("sttModelPath or VOLTZ_STT_MODEL");
  }
  return missing;
}

export function formatLinuxSTTSetupHint(
  diagnostics: LinuxSTTDiagnostics
): string {
  const missing = getLinuxSTTMissingRequirements(diagnostics);
  const details = [`Missing ${missing.join(", ")}.`];
  if (!diagnostics.modelPath) {
    details.push("Set `sttModelPath` in config or `VOLTZ_STT_MODEL`.");
  }
  return details.join(" ");
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

class LinuxWhisperSTTEngine implements STTEngine {
  readonly name = "linux-whisper";

  async isAvailable(): Promise<boolean> {
    const diagnostics = getLinuxSTTDiagnostics();
    return (
      process.platform === "linux" &&
      diagnostics.ffmpegAvailable &&
      diagnostics.whisperBinary !== null &&
      diagnostics.modelPath !== null
    );
  }

  listen(options?: { silence?: number; maxDuration?: number }): Promise<string | null> {
    return listenLinux(options);
  }
}

registerSTT("linux-whisper", () => new LinuxWhisperSTTEngine());
