import chalk from "chalk";
import ora from "ora";
import { captureFrame } from "../vision/capture.js";
import { streamQuery } from "../agent/session.js";
// Trigger engine self-registration
import "../voice/tts.js";
import { getTTSEngine, detectTTS, type TTSEngine } from "../voice/registry.js";
import { logger, setSession } from "../logger.js";
import { loadConfig } from "../config.js";
import { SilentError } from "../errors.js";

export async function lookCommand(description?: string): Promise<void> {
  const sessionId = `look-${Date.now()}`;
  setSession(sessionId);
  logger.info("look", "start");

  const config = loadConfig();

  // Resolve TTS engine from config or auto-detect
  const ttsEngine: TTSEngine =
    (config?.ttsEngine ? getTTSEngine(config.ttsEngine) : null) ??
    (await detectTTS()) ??
    (() => {
      console.log(chalk.red("No TTS engine available. Run: voltz setup"));
      throw new SilentError();
    })();

  process.on("SIGINT", () => {
    ttsEngine.stop();
    logger.flush();
    process.exit(0);
  });

  // Capture
  const captureSpinner = ora({
    text: chalk.yellow("Capturing webcam frame..."),
    spinner: "dots",
  }).start();

  let imageBase64: string;
  try {
    const frame = await captureFrame();
    imageBase64 = frame.toString("base64");
    captureSpinner.succeed(chalk.dim("Frame captured"));
    logger.info("look", "frame-captured");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    captureSpinner.fail(chalk.red(`Webcam capture failed: ${msg}`));
    logger.error("look", "capture-failed", { error: msg });
    throw new SilentError();
  }

  // Analyze
  const prompt =
    description ||
    "What do you see on my workbench? Identify components and suggest what I might be building.";

  const thinkSpinner = ora({
    text: chalk.yellow("Analyzing..."),
    spinner: "dots",
  }).start();

  try {
    let firstChunk = true;
    for await (const chunk of streamQuery(prompt, { imageBase64 })) {
      if (chunk.type === "text") {
        if (firstChunk) {
          thinkSpinner.stop();
          firstChunk = false;
        }
        process.stdout.write(chalk.green(chunk.text));
        ttsEngine.feedText(chunk.text);
      }
    }

    if (firstChunk) {
      thinkSpinner.info(chalk.dim("No response"));
      logger.warn("look", "empty-response");
    } else {
      process.stdout.write("\n");
      await ttsEngine.flush();
      logger.info("look", "done");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    thinkSpinner.fail(chalk.red(`Error: ${msg}`));
    logger.error("look", "query-error", { error: msg });
    throw new SilentError();
  }
}
