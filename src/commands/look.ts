import chalk from "chalk";
import ora from "ora";
import { captureFrame } from "../vision/capture.js";
import { streamQuery } from "../agent/session.js";
import { TTS } from "../voice/tts.js";

export async function lookCommand(description?: string): Promise<void> {
  const tts = new TTS();

  process.on("SIGINT", () => {
    tts.stopSpeaking();
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
  } catch (err) {
    captureSpinner.fail(
      chalk.red(
        `Webcam capture failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    process.exit(1);
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
        tts.feedText(chunk.text);
      }
    }

    if (firstChunk) {
      thinkSpinner.info(chalk.dim("No response"));
    } else {
      process.stdout.write("\n");
      await tts.flush();
    }
  } catch (err) {
    thinkSpinner.fail(
      chalk.red(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
}
