import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  DEFAULT_PROVIDER,
  ensureVoltzDir,
  getDefaultBaseURL,
  getDefaultModel,
  getProviderLabel,
  loadConfig,
  saveConfig,
  STT_BINARY,
  type ProviderName,
} from "../config.js";
import { logger } from "../logger.js";
import {
  detectSTT,
  detectTTS,
  listSTTEngines,
  listTTSEngines,
} from "../voice/registry.js";
import {
  formatLinuxSTTSetupHint,
  getLinuxSTTDiagnostics,
  isFFmpegAvailable,
} from "../voice/stt.js";
import "../voice/tts.js";

function resolveOptionalConfigInput(input: string, current?: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return current;
  }
  if (trimmed === "-" || trimmed.toLowerCase() === "auto") {
    return undefined;
  }
  return trimmed;
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function parseProviderChoice(input: string, fallback: ProviderName): ProviderName {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (trimmed === "1" || trimmed === "anthropic") return "anthropic";
  if (
    trimmed === "2" ||
    trimmed === "openai" ||
    trimmed === "openai-compatible" ||
    trimmed === "compatible"
  ) {
    return "openai-compatible";
  }
  return fallback;
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
  const currentProvider = existing?.provider ?? DEFAULT_PROVIDER;
  console.log(chalk.dim("Providers:"));
  console.log(chalk.dim(`  1. ${getProviderLabel("anthropic")}`));
  console.log(chalk.dim(`  2. ${getProviderLabel("openai-compatible")}`));
  const providerAnswer = await ask(
    rl,
    chalk.cyan(
      `Provider [${currentProvider === "anthropic" ? "1" : "2"}]: `
    )
  );
  const provider = parseProviderChoice(providerAnswer, currentProvider);
  const reusingExistingProviderConfig =
    (existing?.provider ?? DEFAULT_PROVIDER) === provider;

  let apiKey = reusingExistingProviderConfig ? existing?.apiKey ?? "" : "";

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
    apiKey = await ask(
      rl,
      chalk.cyan(`${getProviderLabel(provider)} API key: `)
    );
    if (!apiKey.startsWith("sk-")) {
      console.log(
        chalk.yellow("Warning: many hosted provider keys start with 'sk-'\n")
      );
    }
  }

  const currentModel = reusingExistingProviderConfig
    ? existing?.model ?? getDefaultModel(provider)
    : getDefaultModel(provider);
  const modelAnswer = await ask(
    rl,
    chalk.cyan(`Model [${currentModel}]: `)
  );
  const model = modelAnswer || currentModel;

  let baseURL: string | undefined;
  if (provider === "openai-compatible") {
    const currentBaseURL = reusingExistingProviderConfig
      ? existing?.baseURL ?? getDefaultBaseURL("openai-compatible") ?? ""
      : getDefaultBaseURL("openai-compatible") ?? "";
    const baseURLAnswer = await ask(
      rl,
      chalk.cyan(`Base URL [${currentBaseURL}]: `)
    );
    baseURL = baseURLAnswer || currentBaseURL;
  }

  let sttModelPath = existing?.sttModelPath;
  let micDevice = existing?.micDevice;
  if (process.platform === "linux") {
    console.log(chalk.dim("\nLinux voice settings (optional):"));
    console.log(
      chalk.dim(
        "Leave blank to keep the current value. Enter `auto` to clear an override."
      )
    );

    const modelPathAnswer = await ask(
      rl,
      chalk.cyan(
        `STT model path [${existing?.sttModelPath ?? "auto-detect"}]: `
      )
    );
    sttModelPath = resolveOptionalConfigInput(modelPathAnswer, existing?.sttModelPath);

    const micAnswer = await ask(
      rl,
      chalk.cyan(
        `Mic device override [${existing?.micDevice ?? "auto"}]: `
      )
    );
    micDevice = resolveOptionalConfigInput(micAnswer, existing?.micDevice);
  }

  ensureVoltzDir();
  saveConfig({
    provider,
    apiKey,
    model,
    baseURL: provider === "openai-compatible" ? baseURL : undefined,
    sttModelPath,
    micDevice,
  });
  console.log(chalk.green("Provider settings saved.\n"));

  // 2. STT binary
  const sttSpinner = ora({
    text: "Checking STT binary...",
    spinner: "dots",
  }).start();

  const sttEngine = await detectSTT();
  if (sttEngine) {
    sttSpinner.succeed(chalk.green(`STT available via ${sttEngine.name}`));
  } else if (process.platform === "darwin" && existsSync(STT_BINARY)) {
    sttSpinner.succeed(chalk.green("STT binary found"));
  } else if (process.platform === "linux") {
    const diagnostics = getLinuxSTTDiagnostics();
    sttSpinner.warn(chalk.yellow(formatLinuxSTTSetupHint(diagnostics)));
    console.log(
      chalk.dim(
        `Linux STT backends: ${diagnostics.backends
          .map((backend) => `${backend.format}:${backend.device}`)
          .join(", ")}`
      )
    );
    if (diagnostics.modelPath) {
      console.log(chalk.dim(`Model path: ${diagnostics.modelPath}`));
    }
  } else {
    sttSpinner.warn(chalk.yellow("No STT engine detected yet"));
  }

  // 3. TTS test
  const ttsSpinner = ora({
    text: "Testing TTS...",
    spinner: "dots",
  }).start();

  const ttsEngine = await detectTTS();
  if (ttsEngine) {
    ttsEngine.feedText("Voltz is ready.");
    await ttsEngine.flush();
    ttsSpinner.succeed(chalk.green(`TTS working via ${ttsEngine.name}`));
  } else {
    ttsSpinner.fail(chalk.red("TTS failed — no engine available"));
  }

  // 4. ffmpeg check
  const ffmpegSpinner = ora({
    text: "Checking ffmpeg...",
    spinner: "dots",
  }).start();

  const ffmpegOk = isFFmpegAvailable();
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
