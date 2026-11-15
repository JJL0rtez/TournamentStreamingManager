
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface RecordingConfig {
  cameraName: string;
  microphoneName: string;
  outputDirectory: string;
  width: number;
  height: number;
  fps: number;
}

export class Recorder {

  onExit?: (code: number | null) => void;

  private ffmpegProcess: ChildProcess | null = null;
  private recordingPath: string | null = null;

  get isRecording(): boolean {
    return this.ffmpegProcess !== null;
  }

  get currentRecordingPath(): string | null {
    return this.recordingPath;
  }

  async start(config: RecordingConfig): Promise<string> {
    if (this.ffmpegProcess) {
      throw new Error("A recording is already running.");
    }

    await mkdir(config.outputDirectory, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const outputPath = path.join(
      config.outputDirectory,
      `recording-${timestamp}.mkv`
    );

    const args = [
      "-hide_banner",
      "-y",
      "-f", "dshow",
      "-rtbufsize", "512M",
      "-vcodec", "mjpeg",
      "-video_size", `${config.width}x${config.height}`,
      "-framerate", String(config.fps),
      "-i", `video=${config.cameraName}:audio=${config.microphoneName}`,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-b:v", "8M",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      outputPath
    ];

    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

   
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"]
    });

    this.ffmpegProcess = child;
    this.recordingPath = outputPath;


    child.stderr?.setEncoding("utf8");

    let ffmpegOutput = "";

    child.stderr?.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      ffmpegOutput += chunk;

      if (ffmpegOutput.length > 16000) {
        ffmpegOutput = ffmpegOutput.slice(-8000);
      }
    });


    child.on("close", (code) => {
      console.log(`FFmpeg exited with code ${code}`);

      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
        this.recordingPath = null;
      }

      this.onExit?.(code);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
        this.recordingPath = null;
      }

      throw new Error(
        `Unable to launch FFmpeg: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    child.on("close", (code) => {
      console.log(`FFmpeg exited with code ${code}`);

      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
        this.recordingPath = null;
      }

      this.onExit?.(code);
    });

    return outputPath;
  }


  async stop(): Promise<void> {
    const child = this.ffmpegProcess;

    if (!child) {
      console.log("No recording is running.");
      return;
    }

    console.log("Sending stop command to FFmpeg...");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("FFmpeg did not stop within 15 seconds."));
      }, 15000);

      child.once("close", (code) => {
        clearTimeout(timeout);
        console.log(`Recording finalized. Exit code: ${code}`);
        resolve();
      });

      if (!child.stdin?.writable) {
        clearTimeout(timeout);
        reject(new Error("FFmpeg stdin is unavailable."));
        return;
      }

      child.stdin.write("q\n");
    });
  }

}
