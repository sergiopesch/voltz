# Voltz

Voice-first AI companion for electronics and robotics enthusiasts. Speak questions, get spoken answers — hands-free while soldering.

```
$ npm install -g voltz
$ voltz setup          # paste API key, test mic/speaker
$ voltz                # speak, get spoken answers
```

## What it does

- **Voice mode** — speak a question, hear the answer through your speakers
- **Chat mode** — text-based fallback when you can't use voice
- **Vision mode** — point your webcam at a circuit and ask "what's wrong?"
- **Electronics knowledge** — knows component specs, pinouts, formulas, and safety warnings

## Requirements

- macOS 14+ (uses native Speech Recognition and TTS)
- Node.js 20+
- Anthropic API key
- ffmpeg (optional, for webcam features): `brew install ffmpeg`

## Usage

```bash
voltz              # Voice mode (default) — speak and listen
voltz chat         # Text chat mode
voltz look         # Capture webcam + describe what you see
voltz look "check my soldering"  # Webcam with custom prompt
voltz setup        # Configure API key, test hardware
```

## Architecture

```
voltz (TypeScript CLI — orchestrator)
 ├── State Machine      (pure-function voice loop transitions)
 ├── Engine Registry    (pluggable STT/TTS engines)
 ├── Swift binary       (mic → SFSpeechRecognizer → text)
 ├── say command        (text → macOS TTS → speaker)
 ├── ffmpeg             (webcam → frame capture)
 └── Claude Agent SDK   (LLM brain with streaming)
```

Single process, no Docker, no cloud services beyond the Anthropic API.

### Voice State Machine

The voice loop is driven by a pure-function state machine — no ad-hoc state mutations. Phases, events, and transitions are declared; actions are returned as data and dispatched by the command. This makes the core loop testable and predictable.

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (repeat)
                 ↘ CAPTURING → THINKING    (webcam path)
```

### Engine Registry

STT and TTS are pluggable via a self-registering engine registry. Default engines use native macOS APIs. Adding a new engine (e.g., Whisper, ElevenLabs) means implementing one interface and calling `registerSTT()` or `registerTTS()`.

## Configuration

Settings live in `~/.voltz/config.json`. Personal overrides go in `~/.voltz/config.local.json` (field-by-field merge, local takes priority).

```jsonc
// ~/.voltz/config.json
{
  "apiKey": "sk-ant-...",
  "silenceTimeout": 1.5,
  "maxDuration": 30,
  "ttsVoice": "Samantha",
  "logLevel": "info"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `apiKey` | — | Anthropic API key (or set `ANTHROPIC_API_KEY` env var) |
| `sttEngine` | auto | STT engine name (`apple-speech`) |
| `ttsEngine` | auto | TTS engine name (`apple-say`) |
| `ttsVoice` | `Samantha` | macOS TTS voice |
| `silenceTimeout` | `1.5` | Seconds of silence before STT stops |
| `maxDuration` | `30` | Max recording duration in seconds |
| `logLevel` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `systemPromptAppend` | — | Custom text appended to the system prompt |

## Debugging

Structured JSON logs are written to `~/.voltz/logs/voltz.log`:

```bash
# View live logs
tail -f ~/.voltz/logs/voltz.log | jq .

# Filter voice events
tail -f ~/.voltz/logs/voltz.log | jq 'select(.component == "voice")'

# Show errors only
tail -f ~/.voltz/logs/voltz.log | jq 'select(.level == "error")'
```

Enable verbose logging:
```bash
# In config
{ "logLevel": "debug" }
```

## Development

```bash
git clone https://github.com/sergiopesch/voltz.git
cd voltz
npm install
npm run build
npm run dev  # Run with hot reload (tsx)
```

### Project Structure

```
voltz/
├── src/
│   ├── index.ts                    # CLI entry + SilentError handling
│   ├── config.ts                   # Two-tier config (base + local override)
│   ├── logger.ts                   # Structured JSON logger (buffered I/O)
│   ├── errors.ts                   # SilentError for clean CLI exits
│   ├── commands/
│   │   ├── voice.ts                # Voice loop (state machine dispatcher)
│   │   ├── chat.ts                 # Text chat with streaming
│   │   ├── look.ts                 # Webcam + vision analysis
│   │   └── setup.ts               # First-time configuration wizard
│   ├── agent/
│   │   ├── session.ts              # Claude Agent SDK streaming wrapper
│   │   └── system-prompt.ts        # Electronics companion persona
│   ├── voice/
│   │   ├── state-machine.ts        # Pure-function state machine
│   │   ├── registry.ts             # Pluggable STT/TTS engine registry
│   │   ├── stt.ts                  # Apple Speech engine
│   │   └── tts.ts                  # Apple say engine (sentence buffering)
│   └── vision/
│       └── capture.ts              # ffmpeg frame capture
├── swift/
│   └── Sources/VoltzSTT/main.swift # Native STT binary
├── knowledge/
│   └── electronics.md              # Component database (16 components)
└── scripts/
    └── build-stt.sh                # Swift binary compilation
```

## License

MIT
