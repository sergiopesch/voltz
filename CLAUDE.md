# Voltz

Voice-first CLI for electronics enthusiasts. Speak questions, get spoken answers — hands-free while soldering.

## Architecture

Single TypeScript CLI orchestrating native macOS components:
- **Swift binary** — mic → SFSpeechRecognizer → text (STT)
- **`say` command** — text → macOS native TTS → speaker
- **ffmpeg** — webcam frame capture for vision
- **Claude Agent SDK** — LLM brain with tools, retry, and fallback
- **Direct Anthropic API** — multimodal vision (image + text), streaming

### Voice State Machine

The voice loop is a pure-function state machine (`src/voice/state-machine.ts`). Transitions produce actions as data, dispatched by the voice command via an iterative event queue.

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (loop)
                 ↘ CAPTURING → THINKING  (webcam path)
```

Phases: `IDLE`, `LISTENING`, `CAPTURING`, `THINKING`, `SPEAKING`, `ERROR`, `ENDED`

### Engine Registry

STT and TTS engines self-register via `src/voice/registry.ts`. Commands use registry functions (`getSTTEngine`, `getTTSEngine`, `detectSTT`, `detectTTS`) — never direct imports. Side-effect imports at the top of commands trigger registration.

Default engines: `apple-speech` (STT), `apple-say` (TTS).

### Config

Settings load from `~/.voltz/config.json` with field-by-field overrides from `~/.voltz/config.local.json`. Validated with zod (`VoltzConfigSchema`), cached in memory.

Settings: `apiKey`, `model`, `sttEngine`, `ttsEngine`, `ttsVoice`, `silenceTimeout`, `maxDuration`, `logLevel`, `maxPerHour`, `maxPerDay`, `dangerousTools`, `systemPromptAppend`.

### Security

- Agent is sandboxed — read-only tools by default (Read, Glob, Grep, WebSearch, WebFetch). Bash requires `dangerousTools: true`.
- Config/session/rate-limit files written `0600`. `~/.voltz/` dir `0700`. Helper: `writePrivateFile()`.
- All child processes have `AbortSignal.timeout()`: STT 60s, TTS 30s, ffmpeg 15s.
- API keys redacted in structured logs.

### Vision

Vision queries route directly to `streamAnthropicDirect` with multimodal content blocks (`ImageBlockParam` + text), bypassing the Agent SDK.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry, global flags, update notifier |
| `src/commands/voice.ts` | Voice loop — state machine dispatcher |
| `src/commands/chat.ts` | Text chat with streaming |
| `src/commands/look.ts` | Webcam capture + vision |
| `src/commands/setup.ts` | First-time configuration |
| `src/commands/doctor.ts` | Diagnostic checks |
| `src/commands/completions.ts` | Shell completions (bash/zsh/fish) |
| `src/agent/session.ts` | Agent SDK, retry, rate limiting, sandbox |
| `src/agent/providers.ts` | Direct Anthropic API (multimodal) |
| `src/agent/system-prompt.ts` | Electronics companion persona |
| `src/rate-limit.ts` | Per-hour/per-day rate limiter |
| `src/config.ts` | Two-tier config, zod validation, caching |
| `src/logger.ts` | Structured JSON logger |
| `src/errors.ts` | SilentError for clean CLI exits |
| `src/voice/state-machine.ts` | Pure-function state machine |
| `src/voice/registry.ts` | STT/TTS engine registry |
| `src/voice/stt.ts` | Apple Speech STT engine |
| `src/voice/tts.ts` | Apple `say` TTS engine |
| `src/vision/capture.ts` | ffmpeg frame capture |
| `knowledge/electronics.md` | Component database |

## Patterns

- **State machine** — voice transitions are pure functions; actions are data, not side effects
- **Engine registry** — self-registering plugins with auto-detect
- **SilentError** — print user-friendly error, throw SilentError for clean exit
- **Two-tier config** — base + local overrides, zod validation, in-memory cache
- **Structured logging** — JSON logs with session context, secret redaction, `0600` perms
- **Retry with backoff** — 3 attempts, exponential delay, 45s budget, direct API fallback
- **Rate limiting** — per-hour and per-day counters with async persistence
- **Agent sandbox** — read-only tools by default; Bash opt-in

## Development

```bash
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm test             # Run tests (vitest)
npm run test:watch   # Tests in watch mode
npm run postinstall  # Rebuild Swift binary
```

## Debugging

```bash
voltz --verbose                   # debug-level logs
tail -f ~/.voltz/logs/voltz.log | jq .
tail -f ~/.voltz/logs/voltz.log | jq 'select(.component == "voice")'
```

`voltz doctor` — full diagnostic check of API key, STT, TTS, ffmpeg, config, and rate limits.
