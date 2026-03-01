import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { ensureVoltzDir, saveConfig, loadConfig, STT_BINARY } from "../config.js";
import { logger } from "../logger.js";
import { listSTTEngines, listTTSEngines } from "../voice/registry.js";
// Trigger engine self-registration
import "../voice/stt.js";
import "../voice/tts.js";

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function runCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function setupCommand(): Promise<void> {
  logger.info("setup", "start");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold("\nVoltz Setup\n"));

  // 1. API Key
  const existing = loadConfig();
  let apiKey = existing?.apiKey ?? "";

  if (apiKey) {
    const masked = apiKey.slice(0, 10) + "..." + apiKey.slice(-4);
    console.log(chalk.dim(`Current API key: ${masked}`));
    const change = await ask(rl, chalk.cyan("Change API key? (y/N): "));
    if (change.toLowerCase() !== "y") {
      console.log(chalk.dim("Keeping existing key.\n"));
    } else {
      apiKey = "";
    }
  }

  if (!apiKey) {
    apiKey = await ask(rl, chalk.cyan("Anthropic API key: "));
    if (!apiKey.startsWith("sk-")) {
      console.log(chalk.yellow("Warning: API key usually starts with 'sk-'\n"));
    }
  }

  ensureVoltzDir();
  saveConfig({ apiKey });
  console.log(chalk.green("API key saved.\n"));

  // 2. STT binary
  const sttSpinner = ora({
    text: "Checking STT binary...",
    spinner: "dots",
  }).start();

  if (existsSync(STT_BINARY)) {
    sttSpinner.succeed(chalk.green("STT binary found"));
  } else {
    sttSpinner.warn(
      chalk.yellow("STT binary not found. Run: npm run postinstall")
    );
  }

  // 3. TTS test
  const ttsSpinner = ora({
    text: "Testing TTS...",
    spinner: "dots",
  }).start();

  const ttsOk = await runCommand("say", ["-v", "Samantha", "Voltz is ready"]);
  if (ttsOk) {
    ttsSpinner.succeed(chalk.green("TTS working"));
  } else {
    ttsSpinner.fail(chalk.red("TTS failed — 'say' command not available"));
  }

  // 4. ffmpeg check
  const ffmpegSpinner = ora({
    text: "Checking ffmpeg...",
    spinner: "dots",
  }).start();

  const ffmpegOk = await runCommand("ffmpeg", ["-version"]);
  if (ffmpegOk) {
    ffmpegSpinner.succeed(chalk.green("ffmpeg available (webcam ready)"));
  } else {
    ffmpegSpinner.info(
      chalk.dim("ffmpeg not found — webcam features disabled. Install with: brew install ffmpeg")
    );
  }

  // 5. Show registered engines
  const sttEngines = listSTTEngines();
  const ttsEngines = listTTSEngines();
  console.log(chalk.dim(`\nSTT engines: ${sttEngines.join(", ") || "none"}`));
  console.log(chalk.dim(`TTS engines: ${ttsEngines.join(", ") || "none"}`));

  // Done
  console.log(chalk.bold("\nSetup complete!"));
  console.log(chalk.dim("Run 'voltz' to start voice mode.\n"));

  logger.info("setup", "complete");
  logger.flush();
  rl.close();
}
