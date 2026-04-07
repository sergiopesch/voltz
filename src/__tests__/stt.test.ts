import { describe, expect, it } from "vitest";
import {
  buildLinuxRecordingBackends,
  getLinuxSTTMissingRequirements,
  parseWhisperTranscript,
} from "../voice/stt.js";

describe("STT helpers", () => {
  it("strips whisper.cpp noise from transcripts", () => {
    const transcript = parseWhisperTranscript(`
whisper_init_from_file_with_params_no_state: loading model
system_info: n_threads = 8
[00:00:00.000 --> 00:00:01.500]  hello world
main: processing time = 100 ms
[00:00:01.500 --> 00:00:02.500]  from linux
`);

    expect(transcript).toBe("hello world from linux");
  });

  it("keeps plain transcript output intact", () => {
    expect(parseWhisperTranscript("simple answer")).toBe("simple answer");
  });

  it("builds default linux recording backends", () => {
    expect(buildLinuxRecordingBackends(null)).toEqual([
      { format: "pulse", device: "default" },
      { format: "alsa", device: "default" },
    ]);
  });

  it("supports explicit linux mic backend overrides", () => {
    expect(buildLinuxRecordingBackends("pulse:alsa_input.usb")).toEqual([
      { format: "pulse", device: "alsa_input.usb" },
    ]);
  });

  it("reports missing linux stt requirements", () => {
    expect(
      getLinuxSTTMissingRequirements({
        ffmpegAvailable: false,
        whisperBinary: null,
        modelPath: null,
        micOverride: null,
        backends: [],
      })
    ).toEqual(["ffmpeg", "whisper-cli", "sttModelPath or VOLTZ_STT_MODEL"]);
  });
});
