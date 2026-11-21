import { guardFfmpegPipes, requestFfmpegQuit } from "./ffmpeg-pipes.js";
import { PreviewJpegParser } from "./preview-jpeg.js";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export class PreviewStream {
  private process: ChildProcessWithoutNullStreams | null = null;
  private latestFrame: Buffer | null = null;

  start(cameraName: string): void {
    if (this.process) {
      throw new Error("Preview stream is already running.");
    }

    this.latestFrame = null;

    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "dshow",
      "-video_size", "1920x1080",
      "-framerate", "30",
      "-vcodec", "mjpeg",
      "-i", `video=${cameraName}`,
      "-vf", "fps=5,scale=640:360",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ], {
      windowsHide: true
    });

    this.process = ffmpeg;

    guardFfmpegPipes(ffmpeg);
    const parser = new PreviewJpegParser();
    ffmpeg.stdout.on("data", (chunk: Buffer) => parser.push(chunk, frame => { this.latestFrame = frame; }));
    ffmpeg.on("error", error => console.warn("Legacy preview process failed:", error.message));
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      console.error("Preview FFmpeg:", chunk.toString());
    });

    ffmpeg.on("close", () => {
      if (this.process === ffmpeg) {
        this.process = null;
        this.latestFrame = null;
      }
      console.log("Preview process stopped.");
    });
  }

  getFrame(): Buffer | null {
    return this.latestFrame;
  }

  stop(): void {
    if (this.process) {
      requestFfmpegQuit(this.process);
    }
  }
}
