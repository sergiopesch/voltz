# Voltz

Voice-first CLI for electronics enthusiasts. Speak questions, get spoken answers — hands-free while soldering.

## Architecture

Single TypeScript CLI orchestrating native macOS components:
- **Swift binary** — mic → SFSpeechRecognizer → text (STT)
- **`say` command** — text → macOS native TTS → speaker
- **ffmpeg** — webcam frame capture for vision
- **Claude Agent SDK** — LLM brain with streaming

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry (Commander.js) |
| `src/commands/voice.ts` | Voice loop state machine |
| `src/commands/chat.ts` | Text-only fallback |
| `src/commands/look.ts` | Webcam + vision |
| `src/commands/setup.ts` | First-time configuration |
| `src/agent/session.ts` | Claude Agent SDK wrapper |
| `src/voice/stt.ts` | Swift STT binary spawner |
| `src/voice/tts.ts` | Sentence-streaming TTS |
| `src/vision/capture.ts` | ffmpeg frame capture |
| `src/config.ts` | Paths, settings, API key |
| `knowledge/electronics.md` | Component database |

## Development

```bash
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm run postinstall  # Rebuild Swift binary
```
