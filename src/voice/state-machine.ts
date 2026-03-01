/**
 * Voice loop state machine — pure-function transitions inspired by Entire CLI.
 *
 * The state machine declares phases, events, and transitions. Actions are
 * returned as data (not executed), keeping the machine testable and
 * side-effect-free. The voice command loop dispatches returned actions.
 */

// --- Phases ---

export type Phase =
  | "IDLE"
  | "LISTENING"
  | "CAPTURING"
  | "THINKING"
  | "SPEAKING"
  | "ERROR"
  | "ENDED";

// --- Events ---

export type Event =
  | { type: "START" }
  | { type: "SPEECH_DETECTED"; transcript: string }
  | { type: "SILENCE"; }
  | { type: "STT_ERROR"; error: string }
  | { type: "LOOK_DETECTED"; transcript: string }
  | { type: "CAPTURE_DONE"; imageBase64: string; transcript: string }
  | { type: "CAPTURE_FAILED"; transcript: string; error: string }
  | { type: "QUERY_STARTED" }
  | { type: "CHUNK_RECEIVED"; text: string }
  | { type: "QUERY_DONE" }
  | { type: "QUERY_ERROR"; error: string }
  | { type: "SPEECH_FINISHED" }
  | { type: "INTERRUPT" }
  | { type: "STOP" };

// --- Actions (side effects declared, not executed) ---

export type Action =
  | { type: "START_LISTENING" }
  | { type: "STOP_LISTENING" }
  | { type: "CAPTURE_WEBCAM" }
  | { type: "SEND_QUERY"; transcript: string; imageBase64?: string }
  | { type: "FEED_TTS"; text: string }
  | { type: "FLUSH_TTS" }
  | { type: "STOP_TTS" }
  | { type: "SHOW_ERROR"; error: string }
  | { type: "LOG"; level: "info" | "warn" | "error"; msg: string; extra?: Record<string, unknown> }
  | { type: "EXIT" };

// --- Context (mutable state carried between transitions) ---

export interface Context {
  transcript: string;
  imageBase64?: string;
  turnCount: number;
  hasReceivedChunks: boolean;
}

export function initialContext(): Context {
  return { transcript: "", turnCount: 0, hasReceivedChunks: false };
}

// --- Transition result ---

export interface TransitionResult {
  phase: Phase;
  context: Context;
  actions: Action[];
}

// --- The transition function (pure, no side effects) ---

export function transition(
  phase: Phase,
  event: Event,
  ctx: Context
): TransitionResult {
  switch (phase) {
    case "IDLE":
      if (event.type === "START") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "info", msg: "voice-loop-started" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "EXIT" }] };
      }
      break;

    case "LISTENING":
      if (event.type === "SPEECH_DETECTED") {
        const newCtx = {
          ...ctx,
          transcript: event.transcript,
          imageBase64: undefined,
          turnCount: ctx.turnCount + 1,
          hasReceivedChunks: false,
        };
        return {
          phase: "THINKING",
          context: newCtx,
          actions: [
            { type: "LOG", level: "info", msg: "speech-detected", extra: { text: event.transcript, turn: newCtx.turnCount } },
            { type: "SEND_QUERY", transcript: event.transcript },
          ],
        };
      }
      if (event.type === "LOOK_DETECTED") {
        const newCtx = {
          ...ctx,
          transcript: event.transcript,
          imageBase64: undefined,
          turnCount: ctx.turnCount + 1,
          hasReceivedChunks: false,
        };
        return {
          phase: "CAPTURING",
          context: newCtx,
          actions: [
            { type: "LOG", level: "info", msg: "look-detected", extra: { text: event.transcript } },
            { type: "CAPTURE_WEBCAM" },
          ],
        };
      }
      if (event.type === "SILENCE") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "info", msg: "silence-no-speech" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "STT_ERROR") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "error", msg: "stt-error", extra: { error: event.error } },
            { type: "SHOW_ERROR", error: `Mic error: ${event.error}` },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "INTERRUPT" || event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "STOP_LISTENING" }, { type: "EXIT" }] };
      }
      break;

    case "CAPTURING":
      if (event.type === "CAPTURE_DONE") {
        const newCtx = { ...ctx, imageBase64: event.imageBase64 };
        return {
          phase: "THINKING",
          context: newCtx,
          actions: [
            { type: "LOG", level: "info", msg: "webcam-captured" },
            { type: "SEND_QUERY", transcript: event.transcript, imageBase64: event.imageBase64 },
          ],
        };
      }
      if (event.type === "CAPTURE_FAILED") {
        return {
          phase: "THINKING",
          context: ctx,
          actions: [
            { type: "LOG", level: "warn", msg: "webcam-failed", extra: { error: event.error } },
            { type: "SHOW_ERROR", error: `Webcam failed: ${event.error}` },
            { type: "SEND_QUERY", transcript: event.transcript },
          ],
        };
      }
      if (event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "EXIT" }] };
      }
      break;

    case "THINKING":
      if (event.type === "CHUNK_RECEIVED") {
        const newCtx = { ...ctx, hasReceivedChunks: true };
        return {
          phase: "SPEAKING",
          context: newCtx,
          actions: [{ type: "FEED_TTS", text: event.text }],
        };
      }
      if (event.type === "QUERY_DONE") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "info", msg: "query-done-empty", extra: { turn: ctx.turnCount } },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "QUERY_ERROR") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "error", msg: "query-error", extra: { error: event.error, turn: ctx.turnCount } },
            { type: "SHOW_ERROR", error: event.error },
            { type: "STOP_TTS" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "INTERRUPT") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "STOP_TTS" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "STOP_TTS" }, { type: "EXIT" }] };
      }
      break;

    case "SPEAKING":
      if (event.type === "CHUNK_RECEIVED") {
        return {
          phase: "SPEAKING",
          context: ctx,
          actions: [{ type: "FEED_TTS", text: event.text }],
        };
      }
      if (event.type === "QUERY_DONE") {
        return {
          phase: "SPEAKING",
          context: ctx,
          actions: [
            { type: "LOG", level: "info", msg: "query-done", extra: { turn: ctx.turnCount } },
            { type: "FLUSH_TTS" },
          ],
        };
      }
      if (event.type === "SPEECH_FINISHED") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [{ type: "START_LISTENING" }],
        };
      }
      if (event.type === "QUERY_ERROR") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "error", msg: "query-error-during-speech", extra: { error: event.error } },
            { type: "SHOW_ERROR", error: event.error },
            { type: "STOP_TTS" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "INTERRUPT") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [
            { type: "LOG", level: "info", msg: "interrupted" },
            { type: "STOP_TTS" },
            { type: "START_LISTENING" },
          ],
        };
      }
      if (event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "STOP_TTS" }, { type: "EXIT" }] };
      }
      break;

    case "ERROR":
      if (event.type === "START") {
        return {
          phase: "LISTENING",
          context: ctx,
          actions: [{ type: "START_LISTENING" }],
        };
      }
      if (event.type === "STOP") {
        return { phase: "ENDED", context: ctx, actions: [{ type: "EXIT" }] };
      }
      break;

    case "ENDED":
      // Terminal state — no transitions
      return { phase: "ENDED", context: ctx, actions: [] };
  }

  // Unhandled event in current phase — stay put, log it
  return {
    phase,
    context: ctx,
    actions: [
      { type: "LOG", level: "warn", msg: "unhandled-event", extra: { phase, event: event.type } },
    ],
  };
}
