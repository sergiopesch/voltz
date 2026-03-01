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

## Architecture

```
voltz (TypeScript CLI)
 ├── Swift binary (mic → SFSpeechRecognizer → text)
 ├── say command (text → macOS TTS → speaker)
 ├── ffmpeg (webcam → frame capture)
 └── Claude Agent SDK (LLM brain)
```

Single process, no Docker, no cloud services beyond the Anthropic API.

## Usage

```bash
voltz              # Voice mode (default) — speak and listen
voltz chat         # Text chat mode
voltz look         # Capture webcam + describe what you see
voltz look "check my soldering"  # Webcam with custom prompt
voltz setup        # Configure API key, test hardware
```

## Development

```bash
git clone https://github.com/sergiopesch/voltz.git
cd voltz
npm install
npm run build
npm run dev  # Run with hot reload
```

## License

MIT
