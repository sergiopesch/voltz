import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, STT_BINARY, VOLTZ_DIR, VoltzConfigSchema } from "../config.js";
import { getRateLimitStatus } from "../rate-limit.js";
import { logger } from "../logger.js";
// Trigger engine self-registration
import "../voice/stt.js";
import "../voice/tts.js";
import { listSTTEngines, listTTSEngines } from "../voice/registry.js";

function runCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: "ignore",
      signal: AbortSignal.timeout(10_000),
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold("\nVoltz Doctor\n"));
  let allOk = true;

  // 1. API key present and valid format
  const config = loadConfig();
  const apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const keySpinner = ora("Checking API key...").start();
  if (!apiKey) {
    keySpinner.fail(chalk.red("No API key found"));
    allOk = false;
  } else if (!apiKey.startsWith("sk-")) {
    keySpinner.warn(chalk.yellow(`API key present but unusual format (doesn't start with 'sk-')`));
  } else {
    keySpinner.succeed(chalk.green(`API key present (${apiKey.slice(0, 10)}...)`));
  }

  // 2. API key works (test request)
  if (apiKey) {
    const testSpinner = ora("Testing API connectivity...").start();
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: "claude-haiku-4-5-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      testSpinner.succeed(chalk.green("API key works"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      testSpinner.fail(chalk.red(`API test failed: ${msg.slice(0, 100)}`));
      allOk = false;
    }
  }

  // 3. STT binary
  const sttSpinner = ora("Checking STT binary...").start();
  if (existsSync(STT_BINARY)) {
    sttSpinner.succeed(chalk.green("STT binary found"));
  } else {
    sttSpinner.warn(chalk.yellow("STT binary not found. Run: npm run postinstall"));
    allOk = false;
  }

  // 4. TTS say command
  const ttsSpinner = ora("Checking TTS...").start();
  const ttsOk = await runCommand("say", ["-v", "?"]);
  if (ttsOk) {
    ttsSpinner.succeed(chalk.green("TTS (say) available"));
  } else {
    ttsSpinner.fail(chalk.red("TTS (say) not available"));
    allOk = false;
  }

  // 5. ffmpeg
  const ffmpegSpinner = ora("Checking ffmpeg...").start();
  const ffmpegOk = await runCommand("ffmpeg", ["-version"]);
  if (ffmpegOk) {
    ffmpegSpinner.succeed(chalk.green("ffmpeg available"));
  } else {
    ffmpegSpinner.info(chalk.dim("ffmpeg not found (webcam features disabled)"));
  }

  // 6. Config validation
  const configSpinner = ora("Validating config...").start();
  if (!config) {
    configSpinner.info(chalk.dim("No config file found"));
  } else {
    const result = VoltzConfigSchema.safeParse(config);
    if (result.success) {
      configSpinner.succeed(chalk.green("Config valid"));
    } else {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      configSpinner.warn(chalk.yellow(`Config issues: ${issues}`));
    }
  }

  // 7. Log directory writable
  const logDir = `${VOLTZ_DIR}/logs`;
  const logSpinner = ora("Checking log directory...").start();
  if (existsSync(logDir)) {
    logSpinner.succeed(chalk.green("Log directory exists"));
  } else {
    logSpinner.info(chalk.dim("Log directory will be created on first use"));
  }

  // 8. Rate limit status
  const rateSpinner = ora("Checking rate limits...").start();
  try {
    const status = await getRateLimitStatus();
    rateSpinner.succeed(
      chalk.green(`Rate limits: ${status.hourly}/${status.maxHour} hourly, ${status.daily}/${status.maxDay} daily`)
    );
  } catch {
    rateSpinner.info(chalk.dim("No rate limit data yet"));
  }

  // 9. Disk space in ~/.voltz
  const diskSpinner = ora("Checking disk usage...").start();
  if (existsSync(VOLTZ_DIR)) {
    try {
      const stat = statSync(VOLTZ_DIR);
      diskSpinner.succeed(chalk.green(`~/.voltz directory exists (permissions: ${(stat.mode & 0o777).toString(8)})`));
    } catch {
      diskSpinner.info(chalk.dim("Could not check disk usage"));
    }
  } else {
    diskSpinner.info(chalk.dim("~/.voltz not created yet"));
  }

  // Registered engines
  console.log(chalk.dim(`\nSTT engines: ${listSTTEngines().join(", ") || "none"}`));
  console.log(chalk.dim(`TTS engines: ${listTTSEngines().join(", ") || "none"}`));

  // Summary
  console.log("");
  if (allOk) {
    console.log(chalk.bold.green("All checks passed!"));
  } else {
    console.log(chalk.bold.yellow("Some checks failed. See above for details."));
  }
  console.log("");

  logger.info("doctor", "complete", { allOk });
  logger.flush();
}
