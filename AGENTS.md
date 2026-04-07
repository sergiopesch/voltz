# Voltz

Voice-first CLI for electronics enthusiasts. Speak questions, get spoken answers while soldering, probing, or debugging a bench setup.

## Architecture

Single TypeScript CLI orchestrating local platform integrations and provider adapters:

- **Swift binary**: mic → SFSpeechRecognizer → text (STT on macOS)
- **`say` / `espeak`**: text → local TTS on macOS and Linux
- **ffmpeg**: webcam frame capture for vision, with platform-specific inputs
- **Provider adapters**: text streaming, multimodal requests, connectivity checks

## Philosophy

Keep the center of the system small.

- Use a few explicit primitives and compose from there
- Keep provider and platform specifics at the edges
- Prefer serializable local state over opaque remote session machinery when possible
- Use OS processes directly when they are good enough
- Resist framework-shaped complexity unless it clearly buys real capability

### Voice State Machine

The voice loop is a pure-function state machine in `src/voice/state-machine.ts`. Transitions produce actions as data, and commands dispatch those actions with side effects.

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (loop)
                 ↘ CAPTURING → THINKING  (webcam path)
```

Phases: `IDLE`, `LISTENING`, `CAPTURING`, `THINKING`, `SPEAKING`, `ERROR`, `ENDED`

### Engine Registry

STT and TTS engines self-register via `src/voice/registry.ts`. Commands use registry helpers (`getSTTEngine`, `getTTSEngine`, `detectSTT`, `detectTTS`) rather than importing platform engines directly.

Default engines: `apple-speech` (STT), `linux-whisper` (STT), `apple-say` (TTS), `linux-espeak` (TTS).

### Provider Layer

LLM access is provider-neutral at the session layer.

- `anthropic`: Claude Agent SDK for tool-enabled text chat plus Messages API for direct streaming and vision
- `openai-compatible`: compatible `/chat/completions` APIs with local workspace-scoped tool execution and persisted conversation history

Provider selection, credential lookup, and default models are defined in `src/config.ts`. Session orchestration consumes adapters from `src/agent/providers.ts`.

### Config

Settings load from `~/.voltz/config.json` with field-by-field overrides from `~/.voltz/config.local.json`. Validated with zod (`VoltzConfigSchema`) and cached in memory.

Core settings: `provider`, `apiKey`, `model`, `baseURL`, `sttEngine`, `sttModelPath`, `micDevice`, `ttsEngine`, `ttsVoice`, `silenceTimeout`, `maxDuration`, `logLevel`, `maxPerHour`, `maxPerDay`, `dangerousTools`, `systemPromptAppend`.

### Security

- Config, session, and rate-limit files are written `0600`
- `~/.voltz/` is kept at `0700`
- Local agent tools stay inside the active workspace unless `dangerousTools` explicitly enables shell access
- Child processes use `AbortSignal.timeout()` where supported
- Structured logs redact obvious credential fields

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry, global flags, update notifier |
| `src/commands/voice.ts` | Voice loop dispatcher |
| `src/commands/chat.ts` | Text chat with streaming |
| `src/commands/look.ts` | Webcam capture + vision |
| `src/commands/setup.ts` | First-time configuration |
| `src/commands/doctor.ts` | Diagnostic checks |
| `src/commands/completions.ts` | Shell completions |
| `src/agent/session.ts` | Provider-neutral session orchestration, retry, rate limiting |
| `src/agent/providers.ts` | Provider adapters and connectivity checks |
| `src/agent/system-prompt.ts` | Electronics companion persona |
| `src/config.ts` | Config, provider resolution, session persistence |
| `src/rate-limit.ts` | Per-hour/per-day rate limiter |
| `src/logger.ts` | Structured JSON logger |
| `src/errors.ts` | SilentError for clean CLI exits |
| `src/voice/state-machine.ts` | Pure-function voice state machine |
| `src/voice/registry.ts` | STT/TTS engine registry |
| `src/voice/stt.ts` | Apple Speech and Linux whisper.cpp STT backends |
| `src/voice/tts.ts` | Apple `say` and Linux `espeak` TTS backends |
| `src/vision/capture.ts` | ffmpeg frame capture |
| `knowledge/electronics.md` | Bundled electronics reference |

## Patterns

- **State machine**: voice transitions are pure; actions are data, not effects
- **Engine registry**: STT/TTS backends self-register and auto-detect
- **Provider adapters**: session code targets a generic provider interface
- **SilentError**: commands print a user-facing error, then exit cleanly
- **Two-tier config**: base plus local overrides with cache invalidation
- **Structured logging**: JSON logs with session context
- **Retry with backoff**: transient provider failures retry before surfacing
- **Rate limiting**: hourly and daily counters persist locally

## Development

```bash
npm run dev
npm run build
npm test
npm run test:watch
npm run postinstall
```
