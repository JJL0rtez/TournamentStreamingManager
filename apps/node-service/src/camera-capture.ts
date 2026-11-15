
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { streamPort } from "./stream-port.js";


// Input FPS determines the recording FPS. A camera must actually support the
// requested MJPEG mode. 60 fps is opt-in and is never silently claimed.
const captureFps = process.env.TOURNAMENT_CAPTURE_FPS === "60" ? 60 : 30;
const streamFps = 30;
const recordingBitrate = process.env.TOURNAMENT_RECORDING_BITRATE || "12M";
const streamingBitrate = process.env.TOURNAMENT_STREAM_BITRATE || "4500k";
export function getCaptureQualitySettings() {
  return { inputWidth: 1920, inputHeight: 1080, inputFps: captureFps,
    recordingFps: captureFps, recordingBitrate,
    streamingWidth: 1920, streamingHeight: 1080, streamingFps: streamFps,
    streamingBitrate, previewFps: 5 };
}

export interface CameraCaptureConfig {
  cameraName: string;
  cameraDeviceId?: string;
  microphoneName: string;
  outputDirectory: string;
  inputFps?: number;
  inputWidth?: number;
  inputHeight?: number;
  recordingBitrate?: string;
  streamingBitrate?: string;
}


export class CameraCapture {
  private process: ChildProcessWithoutNullStreams | null = null;
  private segmentPattern: string | null = null;
  private buffer = Buffer.alloc(0);
  private latestFrame: Buffer | null = null;
  private lastFrameAt: number | null = null;
  private frameCount = 0;
  private progressBuffer = "";
  private progressFields: Record<string, string> = {};
  private encoderStats: {
    updatedAt: number; frame: number | null; fps: number | null;
    speed: number | null; droppedFrames: number | null;
    bitrateKbps: number | null; outTimeMs: number | null;
  } | null = null;
private recordingPath: string | null = null;
private exitListeners = new Set<() => void>();

onExit(listener: () => void): () => void {
  this.exitListeners.add(listener);

  return () => {
    this.exitListeners.delete(listener);
  };
}

    get isRunning(): boolean {
    return this.process !== null;
    }

  async start(config: CameraCaptureConfig): Promise<string> {
    if (this.process) {
      throw new Error("Camera capture is already running.");
    }

    await mkdir(config.outputDirectory, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(
      config.outputDirectory,
      `${path.basename(path.dirname(config.outputDirectory))}_${path.basename(config.outputDirectory)}_${timestamp}.mkv`
    );
    // Every recording uses a unique timestamped prefix. Existing files are never overwritten.
    this.recordingPath = outputPath.replace(/\.mkv$/, "_0000.mkv");
    this.segmentPattern = outputPath.replace(/\.mkv$/, "_%04d.mkv");
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostats", "-stats_period", "1", "-progress", "pipe:2",
      "-y",
      "-f", "dshow",
      "-rtbufsize", "512M",
      "-use_wallclock_as_timestamps", "1",
      "-vcodec", "mjpeg",
      "-video_size", `${config.inputWidth || 1920}x${config.inputHeight || 1080}`,
      "-framerate", String(config.inputFps || captureFps),
        "-i",
        config.cameraDeviceId
        ? `video=${config.cameraDeviceId}:audio=${config.microphoneName}`
        : `video=${config.cameraName}:audio=${config.microphoneName}`,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-b:v", config.recordingBitrate || recordingBitrate,
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-force_key_frames", "expr:gte(t,n_forced*300)",
      "-f", "segment",
      "-segment_time", "300",
      "-segment_format", "matroska",
      "-reset_timestamps", "1",
      this.segmentPattern,

      "-map", "0:v:0",
      "-vf", "fps=5,scale=640:360",
      "-c:v", "mjpeg",
      "-f", "image2pipe",
      "pipe:1",

      // Separate H.264/AAC transport for independent YouTube relay.
      // Input is MJPEG, so stream copy would NOT produce YouTube-compatible H.264.
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-vf", `fps=${streamFps}`,
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-b:v", config.streamingBitrate || streamingBitrate,
      "-maxrate", config.streamingBitrate || streamingBitrate,
      "-bufsize", "9000k",
      "-g", "60",
      "-keyint_min", "60",
      "-forced-idr", "1",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-f", "mpegts",
      `udp://127.0.0.1:${streamPort(config.cameraDeviceId || config.cameraName)}?pkt_size=1316`
    ];

    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
    this.lastFrameAt = null;
    this.frameCount = 0;
    this.progressBuffer = "";
    this.progressFields = {};
    this.encoderStats = null;

    const ffmpeg = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      args,
      { windowsHide: true }
    );

    this.process = ffmpeg;

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (true) {
        const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));

        if (start < 0) {
          this.buffer = Buffer.alloc(0);
          break;
        }

        const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

        if (end < 0) {
          this.buffer = this.buffer.subarray(start);
          break;
        }


        this.latestFrame = Buffer.from(
          this.buffer.subarray(start, end + 2)
        );

        this.lastFrameAt = Date.now();
        this.frameCount++;

        this.buffer = this.buffer.subarray(end + 2);

      }
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      // FFmpeg -progress emits key=value lines. Parse complete records only;
      // stderr chunks do not necessarily align with line boundaries.
      this.progressBuffer += chunk.toString("utf8");
      if (this.progressBuffer.length > 65536) this.progressBuffer = this.progressBuffer.slice(-8192);
      let newline: number;
      while ((newline = this.progressBuffer.indexOf("\n")) !== -1) {
        const line = this.progressBuffer.slice(0, newline).trim();
        this.progressBuffer = this.progressBuffer.slice(newline + 1);
        const match = /^([a-z_]+)=(.*)$/.exec(line);
        if (!match) {
          if (line) console.error("Shared capture FFmpeg:", line);
          continue;
        }
        this.progressFields[match[1]] = match[2];
        if (match[1] === "progress") {
          const number = (value: string | undefined): number | null => {
            if (!value || value === "N/A") return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          };
          const speedText = this.progressFields.speed?.replace(/x$/, "");
          const bitrateText = this.progressFields.bitrate?.replace(/kbits\/s$/, "").trim();
          this.encoderStats = {
            updatedAt: Date.now(),
            frame: number(this.progressFields.frame),
            fps: number(this.progressFields.fps),
            speed: number(speedText),
            droppedFrames: number(this.progressFields.drop_frames),
            bitrateKbps: number(bitrateText),
            outTimeMs: number(this.progressFields.out_time_ms) === null
              ? null : number(this.progressFields.out_time_ms)! / 1000
          };
          this.progressFields = {};
        }
      }
    });


ffmpeg.on("close", () => {
  if (this.process !== ffmpeg) {
    return;
  }

this.process = null;
this.buffer = Buffer.alloc(0);
this.latestFrame = null;
this.lastFrameAt = null;

  console.log("Shared camera capture stopped.");

  for (const listener of this.exitListeners) {
    try {
      listener();
    } catch (error) {
      console.error("Capture exit listener failed:", error);
    }
  }
});


    ffmpeg.on("error", (error) => {
      console.error("Shared capture error:", error.message);
    });

    return this.recordingPath;
  }

  getEncoderStats() {
    return this.encoderStats ? { ...this.encoderStats,
      ageMs: Date.now() - this.encoderStats.updatedAt } : null;
  }

  getFrame(): Buffer | null {
    return this.latestFrame;
  }

getFrameStats(): {
  lastFrameAt: number | null;
  frameCount: number;
  frameAgeMs: number | null;
} {
  return {
    lastFrameAt: this.lastFrameAt,
    frameCount: this.frameCount,
    frameAgeMs:
      this.lastFrameAt === null
        ? null
        : Date.now() - this.lastFrameAt
  };
}

async getRecordingSegments(): Promise<Array<{ path: string; bytes: number; modifiedAt: string }>> {
  if (!this.recordingPath) return [];
  const dir = path.dirname(this.recordingPath);
  const firstName = path.basename(this.recordingPath);
  const prefix = firstName.slice(0, -"0000.mkv".length);
  try {
    const names = (await readdir(dir)).filter(name =>
      name.startsWith(prefix) && /^\d{4,}\.mkv$/.test(name.slice(prefix.length))
    ).sort();
    const segments = await Promise.all(names.map(async name => {
      const filePath = path.join(dir, name);
      try {
        const info = await stat(filePath);
        return { path: filePath, bytes: info.size, modifiedAt: info.mtime.toISOString() };
      } catch { return null; }
    }));
    return segments.filter((item): item is NonNullable<typeof item> => item !== null);
  } catch { return []; }
}

async getRecordingFileSize(): Promise<number | null> {
  if (!this.recordingPath) return null;
  const segments = await this.getRecordingSegments();
  return segments.length ? segments.reduce((total, item) => total + item.bytes, 0) : null;
}

async waitUntilReady(timeoutMs = 10000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (this.latestFrame) {
      return;
    }

    if (!this.isRunning) {
      throw new Error("FFmpeg stopped before producing a preview frame.");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Camera capture did not produce a preview frame within ${timeoutMs}ms.`
  );
}



async stop(): Promise<void> {
  const ffmpeg = this.process;

  if (!ffmpeg) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      ffmpeg.kill();
      reject(new Error("FFmpeg did not stop within 15 seconds."));
    }, 15000);

    ffmpeg.once("close", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    });

    if (ffmpeg.stdin.writable) {
      ffmpeg.stdin.write("q\n");
    } else {
      ffmpeg.kill();
    }
  });
}

}
