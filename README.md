<p align="center">
  <img src="assets/voltz-logo.svg" alt="Voltz" width="400">
</p>

<p align="center">
  <strong>Voice-first AI companion for electronics and robotics.</strong><br>
  Speak questions, get spoken answers — hands-free while soldering.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/platform-linux-black?style=flat-square&logo=linux&logoColor=white" alt="Linux">
  <img src="https://img.shields.io/badge/node-%3E%3D20-black?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >=20">
  <img src="https://img.shields.io/badge/license-MIT-E60000?style=flat-square" alt="MIT License">
</p>

---

```
$ npm install -g voltz
$ voltz setup
$ voltz
```

## What It Does

- **Voice mode** — speak a question, hear the answer through your speakers
- **Chat mode** — text-based fallback when you can't use voice
- **Vision mode** — point your webcam at a circuit and ask "what's wrong?"
- **Diagnostics** — `voltz doctor` validates your entire setup in seconds
- **Electronics knowledge** — component specs, pinouts, formulas, safety warnings

## Requirements

- macOS 14+ or modern Linux
- Node.js 20+
- API key for a supported model provider
- ffmpeg (optional, for webcam and some Linux backends)
- On Linux, `espeak-ng` or `espeak` for TTS
- On Linux STT, `whisper-cli` plus a local model file

## Model Providers

Voltz is provider-neutral at the app layer.

- `anthropic` uses the Claude Agent SDK for tool-enabled text chat and Anthropic Messages for direct multimodal streaming
- `openai-compatible` works with OpenAI, OpenRouter, Ollama, local gateways, and other compatible `/chat/completions` APIs, with local workspace-scoped tool execution and persisted session history

The selected provider controls credential lookup, connectivity checks, and the default model.

## Philosophy

Voltz should stay small in the center and powerful at the edges.

- Prefer a few explicit primitives over layered framework code
- Keep session state serializable and local when possible
- Push provider-specific behavior into adapters instead of the command layer
- Prefer OS tools and simple processes over hidden daemons
- Add capability by composing small parts, not by growing a giant core

## Platform Notes

- macOS currently has the most complete voice stack: native Apple STT, native `say` TTS, and `avfoundation` webcam capture
- Linux now supports `espeak`-based TTS, `video4linux2` webcam capture, and `whisper-cli`-based STT
- Linux STT is not yet at macOS parity, so `chat` and `look` are the most reliable Linux entry points today

## Usage

```bash
voltz                          # Voice mode (default)
voltz chat                     # Text chat
voltz look                     # Webcam + vision analysis
voltz look "check my solder"   # Webcam with custom prompt
voltz setup                    # Configure API key, test hardware
voltz doctor                   # Diagnostic checks
voltz completions zsh          # Shell completions (bash/zsh/fish)
voltz --verbose chat           # Debug logging
voltz --quiet look             # Errors only
```

## Configuration

Settings in `~/.voltz/config.json`. Personal overrides in `~/.voltz/config.local.json` (local wins).

```jsonc
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250514",
  "sttModelPath": "/home/you/.cache/whisper.cpp/ggml-base.en.bin",
  "micDevice": "pulse:default",
  "sttLanguage": "en",
  "ttsVoice": "Samantha",
  "silenceTimeout": 1.5,
  "maxDuration": 30,
  "logLevel": "info"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `provider` | `anthropic` | LLM provider: `anthropic` or `openai-compatible` |
| `apiKey` | — | Provider API key. Env overrides: `VOLTZ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| `model` | provider-specific | Model ID for the selected provider |
| `baseURL` | `https://api.openai.com/v1` | Base URL for `openai-compatible` providers. Env overrides: `VOLTZ_BASE_URL`, `OPENAI_BASE_URL` |
| `sttEngine` | auto | STT engine (`apple-speech`) |
| `sttModelPath` | — | Linux/local STT model path. Env override: `VOLTZ_STT_MODEL` |
| `micDevice` | auto | Optional Linux mic override such as `pulse:default` or `alsa:hw:1,0`. Env override: `VOLTZ_MIC_DEVICE` |
| `sttLanguage` | auto | Preferred STT language code such as `en` |
| `ttsEngine` | auto | TTS engine (`apple-say`) |
| `ttsVoice` | `Samantha` | macOS TTS voice |
| `silenceTimeout` | `1.5` | Seconds of silence before STT stops |
| `maxDuration` | `30` | Max recording duration (seconds) |
| `logLevel` | `info` | `debug` / `info` / `warn` / `error` |
| `maxPerHour` | `60` | Rate limit: queries per hour |
| `maxPerDay` | `500` | Rate limit: queries per day |
| `dangerousTools` | `false` | Enable Bash tool for the agent |
| `systemPromptAppend` | — | Custom text appended to system prompt |

## Architecture

```
voltz (TypeScript CLI)
 ├── STT backends           Apple Speech today, more platform engines over time
 ├── TTS backends           macOS `say`, Linux `espeak`
 ├── ffmpeg + platform IO   webcam capture and media utilities
 └── Provider adapters      model routing, tools, sessions, vision, diagnostics
```

Single process. No Docker. No cloud services beyond the selected model provider.

The voice loop runs as a pure-function state machine — transitions produce actions as data, a dispatcher handles side effects:

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (repeat)
                 ↘ CAPTURING → THINKING  (webcam path)
```

STT and TTS are pluggable via a self-registering engine registry. macOS uses native Apple APIs; Linux currently uses `espeak` for TTS, `whisper-cli` for STT, and v4l2 for webcam capture. Adding Whisper, Deepgram, or ElevenLabs still means implementing one interface and calling `registerSTT()` or `registerTTS()`.

LLM providers are also adapter-based. Anthropic remains supported, but the core session flow now targets a provider interface instead of one SDK. OpenAI-compatible providers now keep local conversation state and can execute local workspace tools in text sessions, which keeps the agent loop generic instead of vendor-shaped.

## Debugging

```bash
voltz --verbose                                                    # debug-level logs
tail -f ~/.voltz/logs/voltz.log | jq .                             # all logs
tail -f ~/.voltz/logs/voltz.log | jq 'select(.level == "error")'   # errors only
```

`voltz doctor` runs a full diagnostic: API key, STT, TTS, ffmpeg, config, rate limits.

## Development

```bash
git clone https://github.com/sergiopesch/voltz.git
cd voltz
npm install
npm run build         # compile TypeScript
npm test              # vitest
npm run dev           # hot reload (tsx)
npm run test:watch    # tests in watch mode
```

## License

MIT
