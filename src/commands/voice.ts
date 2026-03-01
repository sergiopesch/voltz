import chalk from "chalk";
import ora from "ora";
import { listen } from "../voice/stt.js";
import { TTS } from "../voice/tts.js";
import { streamQuery } from "../agent/session.js";
import { captureFrame } from "../vision/capture.js";

type State = "LISTENING" | "THINKING" | "SPEAKING";

export async function voiceCommand(): Promise<void> {
  const tts = new TTS();
  let state: State = "LISTENING";
  let running = true;

  // Graceful shutdown
  process.on("SIGINT", () => {
    running = false;
    tts.stopSpeaking();
    console.log(chalk.dim("\nGoodbye!"));
    process.exit(0);
  });

  console.log(chalk.bold("Voltz") + chalk.dim(" — voice mode"));
  console.log(chalk.dim("Speak to ask a question. Ctrl+C to exit.\n"));

  while (running) {
    // LISTENING
    state = "LISTENING";
    const spinner = ora({
      text: chalk.cyan("Listening..."),
      spinner: "dots",
    }).start();

    let transcript: string | null;
    try {
      transcript = await listen({ silence: 1.5, maxDuration: 30 });
    } catch (err) {
      spinner.fail(
        chalk.red(
          `Mic error: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      continue;
    }

    if (!transcript) {
      spinner.info(chalk.dim("No speech detected"));
      continue;
    }

    spinner.succeed(chalk.white(transcript));

    // Check for "look" keyword to trigger vision
    const isLookCommand =
      transcript.toLowerCase().startsWith("look") ||
      transcript.toLowerCase().includes("look at");

    let imageBase64: string | undefined;
    if (isLookCommand) {
      const captureSpinner = ora({
        text: chalk.yellow("Capturing webcam..."),
        spinner: "dots",
      }).start();
      try {
        const frame = await captureFrame();
        imageBase64 = frame.toString("base64");
        captureSpinner.succeed(chalk.dim("Frame captured"));
      } catch (err) {
        captureSpinner.warn(
          chalk.yellow(
            `Webcam failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    }

    // THINKING
    state = "THINKING";
    const thinkSpinner = ora({
      text: chalk.yellow("Thinking..."),
      spinner: "dots",
    }).start();

    try {
      let firstChunk = true;
      for await (const chunk of streamQuery(transcript, { imageBase64 })) {
        if (chunk.type === "text") {
          if (firstChunk) {
            thinkSpinner.stop();
            state = "SPEAKING";
            firstChunk = false;
          }
          process.stdout.write(chalk.green(chunk.text));
          tts.feedText(chunk.text);
        }
      }

      if (firstChunk) {
        thinkSpinner.info(chalk.dim("No response"));
      } else {
        process.stdout.write("\n\n");
        await tts.flush();
      }
    } catch (err) {
      thinkSpinner.fail(
        chalk.red(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      tts.stopSpeaking();
    }
  }
}
