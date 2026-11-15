
import { spawn } from "node:child_process";

export async function capturePreviewFrame(
  cameraName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "dshow",
      "-video_size", "1920x1080",
      "-framerate", "30",
      "-vcodec", "mjpeg",
      "-i", `video=${cameraName}`,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ], {
      windowsHide: true
    });

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    let errorOutput = "";

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    ffmpeg.on("error", reject);

    ffmpeg.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(
          `FFmpeg preview capture failed (${code}): ${errorOutput}`
        ));
      }
    });
  });
}
