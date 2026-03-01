<p align="center">
  <img src="assets/voltz-logo.svg" alt="Voltz" width="400">
</p>

<p align="center">
  <strong>Voice-first AI companion for electronics and robotics.</strong><br>
  Speak questions, get spoken answers — hands-free while soldering.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple&logoColor=white" alt="macOS">
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

- macOS 14+
- Node.js 20+
- Anthropic API key
- ffmpeg (optional, for webcam): `brew install ffmpeg`

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
  "apiKey": "sk-ant-...",
  "ttsVoice": "Samantha",
  "silenceTimeout": 1.5,
  "maxDuration": 30,
  "logLevel": "info"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `apiKey` | — | Anthropic API key (or `ANTHROPIC_API_KEY` env) |
| `model` | `claude-sonnet-4-5-20250514` | Model ID |
| `sttEngine` | auto | STT engine (`apple-speech`) |
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
 ├── Swift STT binary       mic → SFSpeechRecognizer → text
 ├── macOS say              text → native TTS → speaker
 ├── ffmpeg                 webcam → frame capture → base64
 ├── Claude Agent SDK       LLM with tools, retry, fallback
 └── Claude API             multimodal vision, streaming
```

Single process. No Docker. No cloud services beyond the Anthropic API.

The voice loop runs as a pure-function state machine — transitions produce actions as data, a dispatcher handles side effects:

```
IDLE → LISTENING → THINKING → SPEAKING → LISTENING (repeat)
                 ↘ CAPTURING → THINKING  (webcam path)
```

STT and TTS are pluggable via a self-registering engine registry. Defaults use native macOS APIs. Adding Whisper, Deepgram, or ElevenLabs means implementing one interface and calling `registerSTT()` or `registerTTS()`.

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
