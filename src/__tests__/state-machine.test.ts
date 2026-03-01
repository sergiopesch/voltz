import { describe, it, expect } from "vitest";
import {
  transition,
  initialContext,
  type Phase,
  type Event,
  type Context,
} from "../voice/state-machine.js";

function ctx(overrides?: Partial<Context>): Context {
  return { ...initialContext(), ...overrides };
}

function actionTypes(phase: Phase, event: Event, c = ctx()) {
  return transition(phase, event, c).actions.map((a) => a.type);
}

describe("state-machine", () => {
  // --- IDLE ---

  describe("IDLE phase", () => {
    it("START → LISTENING, emits START_LISTENING + LOG", () => {
      const result = transition("IDLE", { type: "START" }, ctx());
      expect(result.phase).toBe("LISTENING");
      expect(actionTypes("IDLE", { type: "START" })).toContain("START_LISTENING");
      expect(actionTypes("IDLE", { type: "START" })).toContain("LOG");
    });

    it("STOP → ENDED, emits EXIT", () => {
      const result = transition("IDLE", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
      expect(actionTypes("IDLE", { type: "STOP" })).toContain("EXIT");
    });

    it("unhandled event stays in IDLE, logs warning", () => {
      const result = transition("IDLE", { type: "SILENCE" }, ctx());
      expect(result.phase).toBe("IDLE");
      const logAction = result.actions.find((a) => a.type === "LOG");
      expect(logAction).toBeDefined();
      if (logAction?.type === "LOG") {
        expect(logAction.msg).toBe("unhandled-event");
      }
    });
  });

  // --- LISTENING ---

  describe("LISTENING phase", () => {
    it("SPEECH_DETECTED → THINKING, increments turn, emits SEND_QUERY", () => {
      const c = ctx({ turnCount: 2 });
      const result = transition(
        "LISTENING",
        { type: "SPEECH_DETECTED", transcript: "hello" },
        c
      );
      expect(result.phase).toBe("THINKING");
      expect(result.context.turnCount).toBe(3);
      expect(result.context.transcript).toBe("hello");
      expect(result.context.hasReceivedChunks).toBe(false);

      const sendAction = result.actions.find((a) => a.type === "SEND_QUERY");
      expect(sendAction).toBeDefined();
      if (sendAction?.type === "SEND_QUERY") {
        expect(sendAction.transcript).toBe("hello");
      }
    });

    it("LOOK_DETECTED → CAPTURING, emits CAPTURE_WEBCAM", () => {
      const result = transition(
        "LISTENING",
        { type: "LOOK_DETECTED", transcript: "look at this" },
        ctx()
      );
      expect(result.phase).toBe("CAPTURING");
      expect(result.context.transcript).toBe("look at this");
      expect(actionTypes("LISTENING", { type: "LOOK_DETECTED", transcript: "x" })).toContain(
        "CAPTURE_WEBCAM"
      );
    });

    it("SILENCE → LISTENING, re-emits START_LISTENING", () => {
      const result = transition("LISTENING", { type: "SILENCE" }, ctx());
      expect(result.phase).toBe("LISTENING");
      expect(actionTypes("LISTENING", { type: "SILENCE" })).toContain("START_LISTENING");
    });

    it("STT_ERROR → LISTENING, emits SHOW_ERROR + START_LISTENING", () => {
      const result = transition(
        "LISTENING",
        { type: "STT_ERROR", error: "mic unplugged" },
        ctx()
      );
      expect(result.phase).toBe("LISTENING");
      const types = result.actions.map((a) => a.type);
      expect(types).toContain("SHOW_ERROR");
      expect(types).toContain("START_LISTENING");

      const errorAction = result.actions.find((a) => a.type === "SHOW_ERROR");
      if (errorAction?.type === "SHOW_ERROR") {
        expect(errorAction.error).toContain("mic unplugged");
      }
    });

    it("INTERRUPT → ENDED", () => {
      const result = transition("LISTENING", { type: "INTERRUPT" }, ctx());
      expect(result.phase).toBe("ENDED");
      expect(actionTypes("LISTENING", { type: "INTERRUPT" })).toContain("EXIT");
    });

    it("STOP → ENDED", () => {
      const result = transition("LISTENING", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
    });
  });

  // --- CAPTURING ---

  describe("CAPTURING phase", () => {
    it("CAPTURE_DONE → THINKING, stores imageBase64, emits SEND_QUERY", () => {
      const result = transition(
        "CAPTURING",
        { type: "CAPTURE_DONE", imageBase64: "abc123", transcript: "look" },
        ctx({ transcript: "look" })
      );
      expect(result.phase).toBe("THINKING");
      expect(result.context.imageBase64).toBe("abc123");

      const sendAction = result.actions.find((a) => a.type === "SEND_QUERY");
      if (sendAction?.type === "SEND_QUERY") {
        expect(sendAction.imageBase64).toBe("abc123");
        expect(sendAction.transcript).toBe("look");
      }
    });

    it("CAPTURE_FAILED → THINKING, still sends query without image", () => {
      const result = transition(
        "CAPTURING",
        { type: "CAPTURE_FAILED", transcript: "look", error: "no camera" },
        ctx({ transcript: "look" })
      );
      expect(result.phase).toBe("THINKING");
      const types = result.actions.map((a) => a.type);
      expect(types).toContain("SHOW_ERROR");
      expect(types).toContain("SEND_QUERY");

      const sendAction = result.actions.find((a) => a.type === "SEND_QUERY");
      if (sendAction?.type === "SEND_QUERY") {
        expect(sendAction.imageBase64).toBeUndefined();
      }
    });

    it("STOP → ENDED", () => {
      const result = transition("CAPTURING", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
    });
  });

  // --- THINKING ---

  describe("THINKING phase", () => {
    it("CHUNK_RECEIVED → SPEAKING, emits FEED_TTS", () => {
      const result = transition(
        "THINKING",
        { type: "CHUNK_RECEIVED", text: "Hello" },
        ctx()
      );
      expect(result.phase).toBe("SPEAKING");
      expect(result.context.hasReceivedChunks).toBe(true);

      const feedAction = result.actions.find((a) => a.type === "FEED_TTS");
      if (feedAction?.type === "FEED_TTS") {
        expect(feedAction.text).toBe("Hello");
      }
    });

    it("QUERY_DONE without chunks → LISTENING", () => {
      const result = transition("THINKING", { type: "QUERY_DONE" }, ctx());
      expect(result.phase).toBe("LISTENING");
      expect(actionTypes("THINKING", { type: "QUERY_DONE" })).toContain("START_LISTENING");
    });

    it("QUERY_ERROR → LISTENING, shows error + stops TTS", () => {
      const result = transition(
        "THINKING",
        { type: "QUERY_ERROR", error: "timeout" },
        ctx()
      );
      expect(result.phase).toBe("LISTENING");
      const types = result.actions.map((a) => a.type);
      expect(types).toContain("SHOW_ERROR");
      expect(types).toContain("STOP_TTS");
      expect(types).toContain("START_LISTENING");
    });

    it("INTERRUPT → LISTENING, stops TTS", () => {
      const result = transition("THINKING", { type: "INTERRUPT" }, ctx());
      expect(result.phase).toBe("LISTENING");
      expect(actionTypes("THINKING", { type: "INTERRUPT" })).toContain("STOP_TTS");
    });

    it("STOP → ENDED", () => {
      const result = transition("THINKING", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
    });
  });

  // --- SPEAKING ---

  describe("SPEAKING phase", () => {
    it("CHUNK_RECEIVED → SPEAKING, feeds more TTS", () => {
      const result = transition(
        "SPEAKING",
        { type: "CHUNK_RECEIVED", text: " world" },
        ctx({ hasReceivedChunks: true })
      );
      expect(result.phase).toBe("SPEAKING");
      expect(actionTypes("SPEAKING", { type: "CHUNK_RECEIVED", text: "x" })).toContain(
        "FEED_TTS"
      );
    });

    it("QUERY_DONE → SPEAKING, flushes TTS", () => {
      const result = transition(
        "SPEAKING",
        { type: "QUERY_DONE" },
        ctx({ hasReceivedChunks: true })
      );
      expect(result.phase).toBe("SPEAKING");
      expect(actionTypes("SPEAKING", { type: "QUERY_DONE" })).toContain("FLUSH_TTS");
    });

    it("SPEECH_FINISHED → LISTENING", () => {
      const result = transition("SPEAKING", { type: "SPEECH_FINISHED" }, ctx());
      expect(result.phase).toBe("LISTENING");
      expect(actionTypes("SPEAKING", { type: "SPEECH_FINISHED" })).toContain(
        "START_LISTENING"
      );
    });

    it("QUERY_ERROR → LISTENING, stops TTS + shows error", () => {
      const result = transition(
        "SPEAKING",
        { type: "QUERY_ERROR", error: "api down" },
        ctx()
      );
      expect(result.phase).toBe("LISTENING");
      const types = result.actions.map((a) => a.type);
      expect(types).toContain("STOP_TTS");
      expect(types).toContain("SHOW_ERROR");
      expect(types).toContain("START_LISTENING");
    });

    it("INTERRUPT → LISTENING, stops TTS", () => {
      const result = transition("SPEAKING", { type: "INTERRUPT" }, ctx());
      expect(result.phase).toBe("LISTENING");
      const types = result.actions.map((a) => a.type);
      expect(types).toContain("STOP_TTS");
      expect(types).toContain("START_LISTENING");
    });

    it("STOP → ENDED, stops TTS", () => {
      const result = transition("SPEAKING", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
      expect(actionTypes("SPEAKING", { type: "STOP" })).toContain("STOP_TTS");
    });
  });

  // --- ERROR ---

  describe("ERROR phase", () => {
    it("START → LISTENING", () => {
      const result = transition("ERROR", { type: "START" }, ctx());
      expect(result.phase).toBe("LISTENING");
    });

    it("STOP → ENDED", () => {
      const result = transition("ERROR", { type: "STOP" }, ctx());
      expect(result.phase).toBe("ENDED");
    });
  });

  // --- ENDED ---

  describe("ENDED phase", () => {
    it("all events stay in ENDED with no actions", () => {
      for (const event of [
        { type: "START" },
        { type: "STOP" },
        { type: "SILENCE" },
        { type: "INTERRUPT" },
      ] as Event[]) {
        const result = transition("ENDED", event, ctx());
        expect(result.phase).toBe("ENDED");
        expect(result.actions).toHaveLength(0);
      }
    });
  });

  // --- Context preservation ---

  describe("context", () => {
    it("turnCount increments on each SPEECH_DETECTED", () => {
      let c = ctx();
      const r1 = transition("LISTENING", { type: "SPEECH_DETECTED", transcript: "q1" }, c);
      expect(r1.context.turnCount).toBe(1);

      // Simulate returning to LISTENING
      const r2 = transition(
        "LISTENING",
        { type: "SPEECH_DETECTED", transcript: "q2" },
        r1.context
      );
      expect(r2.context.turnCount).toBe(2);
    });

    it("imageBase64 is cleared on new speech (non-look)", () => {
      const c = ctx({ imageBase64: "old" });
      const result = transition(
        "LISTENING",
        { type: "SPEECH_DETECTED", transcript: "plain question" },
        c
      );
      expect(result.context.imageBase64).toBeUndefined();
    });
  });
});
