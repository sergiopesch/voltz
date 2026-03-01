/**
 * Engine registry — plugin pattern for STT and TTS engines.
 *
 * Each engine self-registers. The registry auto-detects which engines
 * are available at runtime and lets you switch between them.
 */

// --- STT Engine interface ---

export interface STTEngine {
  readonly name: string;
  /** Check if this engine can run on the current system */
  isAvailable(): Promise<boolean>;
  /** Listen and return transcribed text, or null if silence */
  listen(options?: { silence?: number; maxDuration?: number }): Promise<string | null>;
}

// --- TTS Engine interface ---

export interface TTSEngine {
  readonly name: string;
  /** Check if this engine can run on the current system */
  isAvailable(): Promise<boolean>;
  /** Feed a text chunk (buffers internally, speaks complete sentences) */
  feedText(chunk: string): void;
  /** Flush remaining buffer and wait for speech to finish */
  flush(): Promise<void>;
  /** Stop all speech immediately */
  stop(): void;
}

// --- Registries ---

const sttEngines = new Map<string, () => STTEngine>();
const ttsEngines = new Map<string, () => TTSEngine>();

export function registerSTT(name: string, factory: () => STTEngine): void {
  sttEngines.set(name, factory);
}

export function registerTTS(name: string, factory: () => TTSEngine): void {
  ttsEngines.set(name, factory);
}

export function getSTTEngine(name: string): STTEngine | null {
  const factory = sttEngines.get(name);
  return factory ? factory() : null;
}

export function getTTSEngine(name: string): TTSEngine | null {
  const factory = ttsEngines.get(name);
  return factory ? factory() : null;
}

export function listSTTEngines(): string[] {
  return [...sttEngines.keys()];
}

export function listTTSEngines(): string[] {
  return [...ttsEngines.keys()];
}

/** Auto-detect the first available STT engine */
export async function detectSTT(): Promise<STTEngine | null> {
  for (const [, factory] of sttEngines) {
    const engine = factory();
    if (await engine.isAvailable()) return engine;
  }
  return null;
}

/** Auto-detect the first available TTS engine */
export async function detectTTS(): Promise<TTSEngine | null> {
  for (const [, factory] of ttsEngines) {
    const engine = factory();
    if (await engine.isAvailable()) return engine;
  }
  return null;
}
