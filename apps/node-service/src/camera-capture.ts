
import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { captureTransportPort } from "./capture-contract.js";


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
  cameraId?: string;
  cameraDeviceId?: string;
  microphoneName: string;
  outputDirectory: string;
  inputFps?: number;
  inputWidth?: number;
  inputHeight?: number;
  recordingBitrate?: string;
  streamingBitrate?: string;
  audioSyncOffsetMs?: number;
  recordingEnabled?: boolean;
  overlays?: Array<{ imagePath: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; offsetX: number; offsetY: number }>;
}


export class CameraCapture {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stopInFlight: Promise<void> | null = null;
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private segmentPattern: string | null = null;
  private buffer = Buffer.alloc(0);
  private latestFrame: Buffer | null = null;
  private lastFrameAt: number | null = null;
  private firstFrameAt: number | null = null;
  private frameCount = 0;
  // Passive diagnostics from the already-running capture; no second camera handle.
  private lastFrameHash: string | null = null;
  private unchangedSince: number | null = null;
  private lastChangedAt: number | null = null;
  // FFmpeg compares decoded pixels, rather than JPEG bytes. A stationary
  // camera scene can legitimately trigger this, so report a warning only.
  private visualFreezeStartedAt: number | null = null;
  private lastVisualMotionAt: number | null = null;
  private silenceStartedAt: number | null = null;
  private lastAudioActivityAt: number | null = null;
  private audioSilenceDetected = false;
  // Per-buffer decoded audio level reported by FFmpeg's astats metadata.
  private lastAudioSampleAt: number | null = null;
  private lastAudibleAt: number | null = null;
  private audioRmsDb: number | null = null;
  private audioSamplesObserved = 0;
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
    if (this.process || this.stopInFlight) {
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

    const audioSyncOffsetMs = config.audioSyncOffsetMs ?? -300;
    const audioSyncFilter = `asetpts=PTS${audioSyncOffsetMs < 0 ? "-" : "+"}${Math.abs(audioSyncOffsetMs) / 1000}/TB`;

    const overlays = (config.overlays ?? []).slice(0, 4);
    const overlayFilters = overlays.length ? (() => {
      const filters: string[] = [config.recordingEnabled === false ? "[0:v]split=2[prev0][stream0]" : "[0:v]split=3[rec0][prev0][stream0]"];
      overlays.forEach((overlay, i) => {
        const input = i + 1;
        const x = overlay.position.endsWith("right") ? `W-w-${overlay.offsetX}` : String(overlay.offsetX);
        const y = overlay.position.startsWith("bottom") ? `H-h-${overlay.offsetY}` : String(overlay.offsetY);
        filters.push(`[${input}:v]format=rgba,setpts=PTS-STARTPTS,split=${config.recordingEnabled === false ? 2 : 3}${config.recordingEnabled === false ? "" : `[img${i}r]`}[img${i}p][img${i}s]`);
        for (const [branch, suffix] of (config.recordingEnabled === false ? [["prev", "p"], ["stream", "s"]] : [["rec", "r"], ["prev", "p"], ["stream", "s"]]) as Array<[string, string]>) {
          filters.push(`[${branch}${i}][img${i}${suffix}]overlay=x=${x}:y=${y}:shortest=0:eof_action=repeat[${branch}${i + 1}]`);
        }
      });
      filters.push(`[prev${overlays.length}]fps=5,scale=640:360,freezedetect=n=-50dB:d=12[prevvid]`);
      filters.push(`[stream${overlays.length}]fps=${streamFps}[streamvid]`);
      return filters.join(";");
    })() : null;

    const args = [
      "-hide_banner",
      "-loglevel", "info",
      "-nostats", "-stats_period", "1", "-progress", "pipe:2",
      "-n",
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
      ...overlays.flatMap(overlay => overlay.imagePath.toLowerCase().endsWith(".gif")
        ? ["-stream_loop", "-1", "-i", overlay.imagePath]
        : ["-loop", "1", "-framerate", "1", "-i", overlay.imagePath]),
      ...(overlayFilters ? ["-filter_complex", overlayFilters] : []),
      ...(config.recordingEnabled === false ? [] : [
      "-map", overlays.length ? `[rec${overlays.length}]` : "0:v:0",
      "-map", "0:a:0",
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-b:v", config.recordingBitrate || recordingBitrate,
      "-pix_fmt", "yuv420p",
      "-af", audioSyncFilter,
      "-c:a", "aac",
      "-b:a", "192k",
      "-force_key_frames", "expr:gte(t,n_forced*300)",
      "-f", "segment",
      "-segment_time", "300",
      "-segment_format", "matroska",
      "-reset_timestamps", "1",
      this.segmentPattern!,
      ]),

      "-map", overlays.length ? "[prevvid]" : "0:v:0",
      ...(!overlays.length ? ["-vf", "fps=5,scale=640:360,freezedetect=n=-50dB:d=12"] : []),
      "-c:v", "mjpeg",
      "-f", "image2pipe",
      "pipe:1",

      // Separate H.264/AAC transport for independent YouTube relay.
      // Input is MJPEG, so stream copy would NOT produce YouTube-compatible H.264.
      "-map", overlays.length ? "[streamvid]" : "0:v:0",
      "-map", "0:a:0",
      ...(!overlays.length ? ["-vf", `fps=${streamFps}`] : []),
      "-c:v", "h264_nvenc",
      "-preset", "p4",
      "-b:v", config.streamingBitrate || streamingBitrate,
      "-maxrate", config.streamingBitrate || streamingBitrate,
      "-bufsize", "9000k",
      "-g", "60",
      "-keyint_min", "60",
      "-forced-idr", "1",
      "-pix_fmt", "yuv420p",
      "-af", `${audioSyncFilter},silencedetect=noise=-50dB:d=8,astats=metadata=1:reset=50,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level`,
      "-c:a", "aac",
      "-b:a", "128k",
      "-f", "mpegts",
      `udp://127.0.0.1:${captureTransportPort(config.cameraId || config.cameraDeviceId || config.cameraName, config.cameraDeviceId)}?pkt_size=1316`
    ];

    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
    this.lastFrameAt = null;
    this.firstFrameAt = null;
    this.frameCount = 0;
    this.lastFrameHash = null;
    this.unchangedSince = null;
    this.lastChangedAt = null;
    this.visualFreezeStartedAt = null;
    this.lastVisualMotionAt = null;
    this.silenceStartedAt = null;
    this.lastAudioActivityAt = null;
    this.audioSilenceDetected = false;
    this.lastAudioSampleAt = null;
    this.lastAudibleAt = null;
    this.audioRmsDb = null;
    this.audioSamplesObserved = 0;
    this.progressBuffer = "";
    this.progressFields = {};
    this.encoderStats = null;
    this.lastExit = null;

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

        const now = Date.now();
        // Exact JPEG equality is a conservative freeze signal. Static scenes with
        // differing compression bytes remain 'unknown', not falsely frozen.
        const hash = createHash("sha256").update(this.latestFrame).digest("hex");
        if (hash !== this.lastFrameHash) {
          this.lastChangedAt = now;
          this.unchangedSince = null;
          this.lastFrameHash = hash;
        } else if (this.unchangedSince === null) {
          this.unchangedSince = now;
        }
        this.firstFrameAt ??= now;
        this.lastFrameAt = now;
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
        // freezedetect analyzes decoded preview pixels. FFmpeg logs a start
        // after 12 seconds and an end when meaningful pixel changes resume.
        const freezeStart = /freeze_start:\s*([-\d.]+)/.exec(line);
        if (freezeStart) {
          this.visualFreezeStartedAt = Date.now() - 12000;
          continue;
        }
        if (/freeze_end:\s*[-\d.]+/.test(line)) {
          this.visualFreezeStartedAt = null;
          this.lastVisualMotionAt = Date.now();
          continue;
        }
        // ametadata prints the RMS level for decoded audio buffers. These
        // records establish actual decoded audio presence, even if silent.
        const rms = /lavfi\.astats\.Overall\.RMS_level\s*=\s*(-?inf|[-+\d.]+)/i.exec(line);
        if (rms) {
          const level = /^-?inf$/i.test(rms[1]) ? -Infinity : Number(rms[1]);
          if (!Number.isNaN(level)) {
            const sampledAt = Date.now();
            this.lastAudioSampleAt = sampledAt;
            this.audioRmsDb = level;
            this.audioSamplesObserved++;
            if (level > -50) {
              this.lastAudibleAt = sampledAt;
              this.lastAudioActivityAt = sampledAt;
            }
          }
          continue;
        }
        // silencedetect logs are emitted only after eight seconds of silence.
        if (/silence_start:\s*[-\d.]+/.test(line)) {
          this.audioSilenceDetected = true;
          this.silenceStartedAt = Date.now() - 8000;
          continue;
        }
        if (/silence_end:\s*[-\d.]+/.test(line)) {
          this.audioSilenceDetected = false;
          this.silenceStartedAt = null;
          this.lastAudioActivityAt = Date.now();
          continue;
        }
        const match = /^([a-z_]+)=(.*)$/.exec(line);
        if (!match) {
          // FFmpeg info messages are expected because silencedetect requires
          // info logging. Only report actionable warnings and errors.
          if (/\[(?:error|warning)\]|Error |Invalid |failed|Conversion failed/i.test(line))
            console.warn("Shared capture FFmpeg:", line);
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


ffmpeg.on("close", (code, signal) => {
  this.lastExit = { code, signal };
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

  getSignalDiagnostics() {
    const now = Date.now();
    const identicalFrameMs = this.unchangedSince === null ? 0 : now - this.unchangedSince;
    const visualFreezeMs = this.visualFreezeStartedAt === null ? null : now - this.visualFreezeStartedAt;
    const frameAgeMs = this.lastFrameAt === null ? null : now - this.lastFrameAt;
    return {
      video: {
        status: frameAgeMs === null ? "waiting" : frameAgeMs > 3000 ? "stalled" : visualFreezeMs !== null ? "possible-freeze" : identicalFrameMs >= 12000 ? "identical-frames" : "receiving",
        frameAgeMs,
        possibleFreezeMs: visualFreezeMs,
        lastVisualMotionAt: this.lastVisualMotionAt,
        identicalFrameMs,
        lastChangedAt: this.lastChangedAt,
        // Exact JPEG matches are definitive, but this is not a perceptual
        // freeze detector. A motionless scene can also be identical.
        detectionMethod: "ffmpeg-decoded-pixel-freezedetect-and-exact-jpeg-hash",
        note: "Possible freeze is a warning, not proof: an unmoving mat may legitimately be static."
      },
      audio: {
        status: this.lastAudioSampleAt === null
          ? (frameAgeMs !== null && this.firstFrameAt !== null && this.lastFrameAt !== null && now - this.firstFrameAt > 10000 && now - this.lastFrameAt < 3000 ? "no-audio-samples" : "waiting-for-audio-samples")
          : now - this.lastAudioSampleAt > 5000 ? "audio-samples-stalled"
          : this.audioRmsDb !== null && this.audioRmsDb > -50 ? "audio-active"
          : "audio-silent",
        rmsDb: this.audioRmsDb === -Infinity ? null : this.audioRmsDb,
        rmsIsNegativeInfinity: this.audioRmsDb === -Infinity,
        audioSamplesObserved: this.audioSamplesObserved,
        lastAudioSampleAt: this.lastAudioSampleAt,
        audioSampleAgeMs: this.lastAudioSampleAt === null ? null : now - this.lastAudioSampleAt,
        lastAudibleAt: this.lastAudibleAt,
        silenceDurationMs: this.silenceStartedAt === null ? null : now - this.silenceStartedAt,
        lastAudioActivityAt: this.lastAudioActivityAt,
        detectionMethod: "ffmpeg-astats-rms-and-silencedetect-minus-50db",
        note: "Decoded audio presence and level are measured locally; this does not verify the YouTube viewer receives audio."
      }
    };
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
      throw new Error(`FFmpeg stopped before producing a preview frame (exit ${this.lastExit?.code ?? "unknown"}, signal ${this.lastExit?.signal ?? "none"}).`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Camera capture did not produce a preview frame within ${timeoutMs}ms.`
  );
}



async stop(): Promise<void> {
  if (this.stopInFlight) return this.stopInFlight;
  const ffmpeg = this.process;
  if (!ffmpeg) return;

  const stopping = new Promise<void>((resolve, reject) => {
    let finished = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer);
      if (killTimer) clearTimeout(killTimer);
      error ? reject(error) : resolve();
    };
    const graceTimer = setTimeout(() => {
      if (finished) return;
      ffmpeg.kill();
      killTimer = setTimeout(() => finish(new Error("FFmpeg did not exit after termination request.")), 5000);
    }, 15000);
    ffmpeg.once("close", () => finish());
    if (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) {
      // The close event still follows exit, allowing the output file to finalize.
      return;
    }
    try {
      if (ffmpeg.stdin.writable) ffmpeg.stdin.write("q\n", (error) => { if (error && !finished) ffmpeg.kill(); });
      else ffmpeg.kill();
    } catch { ffmpeg.kill(); }
  });
  this.stopInFlight = stopping;
  try { await stopping; } finally { if (this.stopInFlight === stopping) this.stopInFlight = null; }
}

}
