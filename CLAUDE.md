# Voltz

Voice-first CLI for electronics enthusiasts. Speak questions, get spoken answers — hands-free while soldering.

## Architecture

Single TypeScript CLI orchestrating native macOS components:
- **Swift binary** — mic → SFSpeechRecognizer → text (STT)
- **`say` command** — text → macOS native TTS → speaker
- **ffmpeg** — webcam frame capture for vision
- **Claude Agent SDK** — LLM brain with streaming

### Voice State Machine

The voice loop is driven by a pure-function state machine (`src/voice/state-machine.ts`). It declares phases, events, and transitions — actions are returned as data and dispatched by the voice command. This keeps the machine testable and side-effect-free.

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (loop)
                 ↘ CAPTURING → THINKING    (webcam path)
```

Phases: `IDLE`, `LISTENING`, `CAPTURING`, `THINKING`, `SPEAKING`, `ERROR`, `ENDED`

### Engine Registry

STT and TTS engines self-register via `src/voice/registry.ts`. Default engines:
- `apple-speech` — SFSpeechRecognizer (STT)
- `apple-say` — macOS `say` command (TTS)

To add engines (Whisper, Deepgram, ElevenLabs), implement `STTEngine` or `TTSEngine` interface and call `registerSTT()`/`registerTTS()`.

### Two-Tier Config

Settings load from `~/.voltz/config.json` with field-by-field overrides from `~/.voltz/config.local.json`. Use `config.local.json` for personal preferences that shouldn't be shared.

Available settings: `apiKey`, `sttEngine`, `ttsEngine`, `ttsVoice`, `silenceTimeout`, `maxDuration`, `logLevel`, `systemPromptAppend`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry (Commander.js) + SilentError handling |
| `src/commands/voice.ts` | Voice loop — dispatches state machine actions |
| `src/commands/chat.ts` | Text-only fallback with streaming |
| `src/commands/look.ts` | Webcam capture + vision analysis |
| `src/commands/setup.ts` | API key, mic/speaker/ffmpeg checks |
| `src/agent/session.ts` | Claude Agent SDK with retry, rate limiting, fallback |
| `src/agent/providers.ts` | Direct Anthropic + OpenAI-compatible fallback |
| `src/agent/system-prompt.ts` | Electronics companion persona |
| `src/rate-limit.ts` | Per-hour/per-day rate limiter with persistence |
| `src/__tests__/state-machine.test.ts` | 28 tests for the voice state machine |
| `src/voice/state-machine.ts` | Pure-function state machine (phases, events, actions) |
| `src/voice/registry.ts` | Plugin registry for STT/TTS engines |
| `src/voice/stt.ts` | Apple Speech STT engine |
| `src/voice/tts.ts` | Apple `say` TTS engine with sentence buffering |
| `src/vision/capture.ts` | ffmpeg single frame capture |
| `src/config.ts` | Two-tier config (config.json + config.local.json) |
| `src/logger.ts` | Structured JSON logger with buffered I/O |
| `src/errors.ts` | SilentError for clean CLI error handling |
| `knowledge/electronics.md` | Component database (16 components) |

## Patterns

- **State machine** — voice loop transitions are pure functions; actions are data, not side effects
- **Engine registry** — self-registering plugins with auto-detect for STT/TTS
- **SilentError** — commands print user-friendly errors, then throw SilentError so the CLI exits without duplicate output
- **Structured logging** — JSON logs to `~/.voltz/logs/voltz.log` with session context, component tags, buffered writes, log rotation, secret redaction
- **Two-tier config** — base config + local overrides, field-by-field merge
- **Retry with backoff** — 3 attempts, exponential delay (2s/4s), 45s budget cap, direct API fallback
- **Rate limiting** — per-hour (60) and per-day (500) counters persisted to `~/.voltz/rate-limit.json`
- **Agent tools** — Bash, Read, Glob, Grep, WebSearch, WebFetch available to the agent
- **Provider fallback** — Agent SDK → direct Anthropic API → error; OpenAI-compatible provider available

## Development

```bash
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm test             # Run tests (vitest)
npm run test:watch   # Tests in watch mode
npm run postinstall  # Rebuild Swift binary
```

## Debugging

Logs are written to `~/.voltz/logs/voltz.log` as JSON. Set `logLevel` to `"debug"` in config for verbose output:

```bash
# View live logs
tail -f ~/.voltz/logs/voltz.log | jq .

# Filter by component
tail -f ~/.voltz/logs/voltz.log | jq 'select(.component == "voice")'
```
