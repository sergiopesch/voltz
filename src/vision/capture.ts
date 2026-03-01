import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function captureFrame(): Promise<Buffer> {
  const outputPath = join(tmpdir(), `voltz-capture-${Date.now()}.jpg`);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-f",
        "avfoundation",
        "-framerate",
        "30",
        "-i",
        "0",
        "-frames:v",
        "1",
        "-y",
        outputPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"], signal: AbortSignal.timeout(15_000) }
    );

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 || !existsSync(outputPath)) {
        reject(new Error(`ffmpeg capture failed (code ${code}): ${stderr}`));
        return;
      }

      try {
        const data = readFileSync(outputPath);
        unlinkSync(outputPath);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `ffmpeg not found. Install with: brew install ffmpeg\n${err.message}`
        )
      );
    });
  });
}
