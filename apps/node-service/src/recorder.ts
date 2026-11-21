import { guardFfmpegPipes } from "./ffmpeg-pipes.js";
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

/** Owns one FFmpeg process. An unexpected exit is reported exactly once. */
export class Recorder {
  onExit?: (code: number | null) => void;
  private ffmpegProcess: ChildProcess | null = null;
  private recordingPath: string | null = null;
  private stopping: Promise<void> | null = null;

  get isRecording(): boolean { return this.ffmpegProcess !== null; }
  get currentRecordingPath(): string | null { return this.recordingPath; }

  async start(config: RecordingConfig): Promise<string> {
    if (this.ffmpegProcess || this.stopping) throw new Error("A recording is already running or stopping.");
    if (!Number.isInteger(config.width) || config.width < 1 || !Number.isInteger(config.height) || config.height < 1 || !Number.isFinite(config.fps) || config.fps <= 0) {
      throw new Error("Invalid recording dimensions or frame rate.");
    }
    await mkdir(config.outputDirectory, { recursive: true });
    const outputPath = path.join(config.outputDirectory, `recording-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.mkv`);
    const args = ["-hide_banner", "-y", "-f", "dshow", "-rtbufsize", "512M", "-vcodec", "mjpeg", "-video_size", `${config.width}x${config.height}`, "-framerate", String(config.fps), "-i", `video=${config.cameraName}:audio=${config.microphoneName}`, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "8M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", outputPath];
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    this.ffmpegProcess = child;
    guardFfmpegPipes(child);
    child.on("error", () => { /* startup and close listeners own lifecycle */ });
    this.recordingPath = outputPath;
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    // Install a single lifecycle listener before awaiting spawn to avoid missed exits.
    child.once("close", (code) => {
      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
        this.recordingPath = null;
        this.onExit?.(code);
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      // FFmpeg can spawn successfully but fail immediately (busy USB device, invalid input).
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); resolve(); }, 750);
        const fail = (code: number | null) => { cleanup(); reject(new Error(`FFmpeg exited during startup (${code ?? "unknown"}): ${stderr.slice(-1200)}`)); };
        const cleanup = () => { clearTimeout(timer); child.off("close", fail); };
        child.once("close", fail);
        if (child.exitCode !== null) fail(child.exitCode);
      });
      return outputPath;
    } catch (error) {
      if (this.ffmpegProcess === child) {
        this.ffmpegProcess = null;
        this.recordingPath = null;
        if (child.exitCode === null) child.kill();
      }
      throw new Error(`Unable to start FFmpeg recording: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.ffmpegProcess;
    if (!child) return;
    this.stopping = new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        child.off("close", closed);
        child.off("error", failed);
        if (error) reject(error); else resolve();
      };
      const closed = () => finish();
      const failed = (error: Error) => finish(error);
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error("FFmpeg did not finalize within 15 seconds; termination requested."));
      }, 15000);
      child.once("close", closed);
      child.once("error", failed);
      if (child.exitCode !== null) { finish(); return; }
      if (child.stdin?.writable) child.stdin.write("q\n", (error) => {
        // A closed stdin is normal when FFmpeg exits concurrently.
        if (error && child.exitCode === null) child.kill();
      });
      else child.kill();
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}
