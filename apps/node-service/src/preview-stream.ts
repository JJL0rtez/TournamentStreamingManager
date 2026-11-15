
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export class PreviewStream {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private latestFrame: Buffer | null = null;

  start(cameraName: string): void {
    if (this.process) {
      throw new Error("Preview stream is already running.");
    }

    this.buffer = Buffer.alloc(0);
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

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (true) {
        const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
        const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

        if (start === -1 || end === -1) {
          break;
        }

        this.latestFrame = Buffer.from(this.buffer.subarray(start, end + 2));
        this.buffer = this.buffer.subarray(end + 2);
      }
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      console.error("Preview FFmpeg:", chunk.toString());
    });

    ffmpeg.on("close", () => {
      this.process = null;
      this.buffer = Buffer.alloc(0);
      console.log("Preview process stopped.");
    });
  }

  getFrame(): Buffer | null {
    return this.latestFrame;
  }

  stop(): void {
    if (this.process) {
      this.process.stdin.write("q\n");
    }
  }
}
