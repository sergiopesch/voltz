import { existsSync, statSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  getProviderEnvHints,
  getProviderLabel,
  getProviderSettings,
  loadConfig,
  STT_BINARY,
  VOLTZ_DIR,
  VoltzConfigSchema,
} from "../config.js";
import { getRateLimitStatus } from "../rate-limit.js";
import { logger } from "../logger.js";
import { createProviderAdapter } from "../agent/providers.js";
import {
  formatLinuxSTTSetupHint,
  getLinuxSTTDiagnostics,
  isFFmpegAvailable,
} from "../voice/stt.js";
import "../voice/tts.js";
import {
  detectSTT,
  detectTTS,
  listSTTEngines,
  listTTSEngines,
} from "../voice/registry.js";

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold("\nVoltz Doctor\n"));
  let allOk = true;

  // 1. API key present and valid format
  const config = loadConfig();
  const providerSettings = getProviderSettings(config);
  const apiKey = providerSettings.apiKey ?? "";
  console.log(
    chalk.dim(
      `Provider: ${getProviderLabel(providerSettings.provider)} (${providerSettings.model})`
    )
  );
  if (providerSettings.baseURL) {
    console.log(chalk.dim(`Base URL: ${providerSettings.baseURL}`));
  }

  const keySpinner = ora("Checking API key...").start();
  if (!apiKey) {
    keySpinner.fail(
      chalk.red(
        `No API key found. Expected ${getProviderEnvHints(providerSettings.provider).join(" or ")}`
      )
    );
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
      const adapter = createProviderAdapter({
        ...providerSettings,
        apiKey,
      });
      await adapter.testConnection();
      testSpinner.succeed(
        chalk.green(`${getProviderLabel(providerSettings.provider)} connection works`)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      testSpinner.fail(chalk.red(`API test failed: ${msg.slice(0, 100)}`));
      allOk = false;
    }
  }

  // 3. STT binary
  const sttSpinner = ora("Checking STT binary...").start();
  const sttEngine = await detectSTT();
  if (sttEngine) {
    sttSpinner.succeed(chalk.green(`STT available via ${sttEngine.name}`));
  } else if (process.platform === "darwin" && existsSync(STT_BINARY)) {
    sttSpinner.succeed(chalk.green("STT binary found"));
  } else if (process.platform === "linux") {
    const diagnostics = getLinuxSTTDiagnostics(config);
    sttSpinner.warn(chalk.yellow(formatLinuxSTTSetupHint(diagnostics)));
    console.log(
      chalk.dim(`  ffmpeg: ${diagnostics.ffmpegAvailable ? "ok" : "missing"}`)
    );
    console.log(
      chalk.dim(
        `  whisper-cli: ${diagnostics.whisperBinary ?? "missing"}`
      )
    );
    console.log(
      chalk.dim(
        `  model: ${diagnostics.modelPath ?? "missing"}`
      )
    );
    console.log(
      chalk.dim(
        `  mic inputs: ${diagnostics.backends
          .map((backend) => `${backend.format}:${backend.device}`)
          .join(", ")}`
      )
    );
    allOk = false;
  } else {
    sttSpinner.warn(chalk.yellow("No STT engine detected"));
    allOk = false;
  }

  // 4. TTS
  const ttsSpinner = ora("Checking TTS...").start();
  const ttsEngine = await detectTTS();
  if (ttsEngine) {
    ttsSpinner.succeed(chalk.green(`TTS available via ${ttsEngine.name}`));
  } else {
    ttsSpinner.fail(chalk.red("No TTS engine available"));
    allOk = false;
  }

  // 5. ffmpeg
  const ffmpegSpinner = ora("Checking ffmpeg...").start();
  const ffmpegOk = isFFmpegAvailable();
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
