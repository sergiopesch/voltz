import chalk from "chalk";
import ora, { type Ora } from "ora";
import { listen } from "../voice/stt.js";
import { TTS } from "../voice/tts.js";
import { streamQuery } from "../agent/session.js";
import { captureFrame } from "../vision/capture.js";
import { logger, setSession } from "../logger.js";
import { loadConfig } from "../config.js";
import { SilentError } from "../errors.js";
import {
  transition,
  initialContext,
  type Phase,
  type Event,
  type Action,
  type Context,
} from "../voice/state-machine.js";

export async function voiceCommand(): Promise<void> {
  const config = loadConfig();
  const tts = new TTS();
  let phase: Phase = "IDLE";
  let ctx = initialContext();
  let spinner: Ora | null = null;

  // Set up session logging
  const sessionId = `voice-${Date.now()}`;
  setSession(sessionId);
  logger.info("voice", "session-start", { sessionId });

  // --- Action dispatcher (executes side effects) ---

  async function dispatch(action: Action): Promise<Event | null> {
    switch (action.type) {
      case "START_LISTENING": {
        spinner?.stop();
        spinner = ora({
          text: chalk.cyan("Listening..."),
          spinner: "dots",
        }).start();

        try {
          const transcript = await listen({
            silence: config?.silenceTimeout ?? 1.5,
            maxDuration: config?.maxDuration ?? 30,
          });

          spinner.stop();
          if (!transcript) {
            spinner.info(chalk.dim("No speech detected"));
            return { type: "SILENCE" };
          }

          spinner.succeed(chalk.white(transcript));

          // Check for "look" keyword
          const lower = transcript.toLowerCase();
          if (lower.startsWith("look") || lower.includes("look at")) {
            return { type: "LOOK_DETECTED", transcript };
          }
          return { type: "SPEECH_DETECTED", transcript };
        } catch (err) {
          spinner.stop();
          const msg = err instanceof Error ? err.message : String(err);
          return { type: "STT_ERROR", error: msg };
        }
      }

      case "STOP_LISTENING":
        spinner?.stop();
        return null;

      case "CAPTURE_WEBCAM": {
        spinner = ora({
          text: chalk.yellow("Capturing webcam..."),
          spinner: "dots",
        }).start();

        try {
          const frame = await captureFrame();
          spinner.succeed(chalk.dim("Frame captured"));
          return {
            type: "CAPTURE_DONE",
            imageBase64: frame.toString("base64"),
            transcript: ctx.transcript,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          spinner.warn(chalk.yellow(`Webcam failed: ${msg}`));
          return {
            type: "CAPTURE_FAILED",
            transcript: ctx.transcript,
            error: msg,
          };
        }
      }

      case "SEND_QUERY": {
        spinner = ora({
          text: chalk.yellow("Thinking..."),
          spinner: "dots",
        }).start();

        // Run the query as a separate async flow — dispatch events back
        queryLoop(action.transcript, action.imageBase64).catch(() => {});
        return null; // events come from queryLoop
      }

      case "FEED_TTS":
        if (spinner) {
          spinner.stop();
          spinner = null;
        }
        process.stdout.write(chalk.green(action.text));
        tts.feedText(action.text);
        return null;

      case "FLUSH_TTS":
        process.stdout.write("\n\n");
        await tts.flush();
        return { type: "SPEECH_FINISHED" };

      case "STOP_TTS":
        tts.stopSpeaking();
        return null;

      case "SHOW_ERROR":
        spinner?.stop();
        console.log(chalk.red(action.error));
        return null;

      case "LOG":
        logger[action.level]("voice", action.msg, action.extra);
        return null;

      case "EXIT":
        logger.info("voice", "session-end", {
          turns: ctx.turnCount,
          sessionId,
        });
        logger.flush();
        return null;
    }
  }

  // --- Process an event through the state machine ---

  async function processEvent(event: Event): Promise<void> {
    const result = transition(phase, event, ctx);
    phase = result.phase;
    ctx = result.context;

    for (const action of result.actions) {
      const nextEvent = await dispatch(action);
      if (nextEvent) {
        await processEvent(nextEvent);
      }
    }
  }

  // --- Query streaming (feeds events back into the machine) ---

  async function queryLoop(
    transcript: string,
    imageBase64?: string
  ): Promise<void> {
    try {
      for await (const chunk of streamQuery(transcript, { imageBase64 })) {
        if (chunk.type === "text") {
          await processEvent({ type: "CHUNK_RECEIVED", text: chunk.text });
        }
      }
      await processEvent({ type: "QUERY_DONE" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await processEvent({ type: "QUERY_ERROR", error: msg });
    }
  }

  // --- Graceful shutdown ---

  process.on("SIGINT", () => {
    logger.info("voice", "sigint");
    tts.stopSpeaking();
    spinner?.stop();
    logger.flush();
    console.log(chalk.dim("\nGoodbye!"));
    process.exit(0);
  });

  // --- Main loop ---

  console.log(chalk.bold("Voltz") + chalk.dim(" — voice mode"));
  console.log(chalk.dim("Speak to ask a question. Ctrl+C to exit.\n"));

  await processEvent({ type: "START" });

  // The state machine drives itself via action → event feedback loops.
  // processEvent is recursive — it keeps running until phase is ENDED
  // or the process is interrupted.

  if ((phase as Phase) === "ENDED") {
    throw new SilentError();
  }
}
