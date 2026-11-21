import { guardFfmpegPipes } from "./ffmpeg-pipes.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { streamPort } from "./stream-port.js";

export type RelayHealth = "connecting" | "sending" | "stalled" | "error";

export function relayHealth(status: "connecting" | "live" | "error", lastProgressAt: number | null, now = Date.now(), stallAfterMs = 15000): RelayHealth {
  if (status === "error") return "error";
  if (lastProgressAt === null) return "connecting";
  return now - lastProgressAt > stallAfterMs ? "stalled" : "sending";
}

export function sanitizeRelayError(message: string, streamKey: string): string {
  return message.replaceAll(streamKey, "[REDACTED]").replace(/rtmps:\/\/[^\s]+/gi, "[REDACTED RTMPS URL]");
}

type StreamSession = {
  cameraId: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  status: "connecting" | "live" | "error";
  lastProgressAt: number | null;
  error: string | null;
  stopping: boolean;
  stopPromise: Promise<void> | null;
  lastProgressFrame: number;
  lastProgressOutTimeUs: number;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  streamKey: string;
  generation: number;
};

export class YouTubeStreamManager {
  private sessions = new Map<string, StreamSession>();
  private lastExits = new Map<string, { at: string; code: number | null; error: string | null }>();
  private retryCounts = new Map<string, { attempts: number; firstAt: number }>();
  private relayGeneration = new Map<string, number>();
  private cancelled = new Set<string>();
  private readonly recoveryEnabled = process.env.TOURNAMENT_RELAY_AUTO_RECOVER === "1";
  private readonly recoveryEvents: Array<{ cameraId: string; at: string; type: "scheduled" | "attempt" | "reconnected" | "exhausted" | "cancelled" | "skipped" | "failed"; detail: string }> = [];
  // Recovery is permitted only while the matching local capture remains active.
  // Distributed relay recovery has a separate lease-aware coordinator in api.ts.
  constructor(private readonly captureIsActive: (cameraId: string) => boolean = () => false) {}

  private recordRecovery(cameraId: string, type: "scheduled" | "attempt" | "reconnected" | "exhausted" | "cancelled" | "skipped" | "failed", detail: string): void {
    this.recoveryEvents.push({ cameraId, type, detail, at: new Date().toISOString() });
    if (this.recoveryEvents.length > 150) this.recoveryEvents.splice(0, this.recoveryEvents.length - 150);
  }

  recoveryEventsSnapshot() { return [...this.recoveryEvents].reverse(); }
  private readonly retryLimit = 3;
  private readonly retryWindowMs = 10 * 60_000;
  private readonly retryDelaysMs = [2000, 4000, 8000];
  private pendingRecovery = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryDueAt = new Map<string, string>();

  recoveryStatus() {
    return [...new Set([...this.retryCounts.keys(), ...this.pendingRecovery.keys()])].map(cameraId => ({
      cameraId, attempts: this.retryCounts.get(cameraId)?.attempts ?? 0,
      pending: this.pendingRecovery.has(cameraId),
      enabled: this.recoveryEnabled,
      captureActive: this.captureIsActive(cameraId),
      nextRetryAt: this.recoveryDueAt.get(cameraId) ?? null
    }));
  }

  private cancelRecovery(cameraId: string) {
    this.cancelled.add(cameraId);
    this.relayGeneration.set(cameraId, (this.relayGeneration.get(cameraId) ?? 0) + 1);
    const timer = this.pendingRecovery.get(cameraId);
    if (timer) {
      clearTimeout(timer);
      this.recordRecovery(cameraId, "cancelled", "Operator stopped relay or restarted it manually.");
    }
    this.pendingRecovery.delete(cameraId);
    this.recoveryDueAt.delete(cameraId);
    this.retryCounts.delete(cameraId);
  }

  private scheduleRecovery(cameraId: string, streamKey: string) {
    if (!this.recoveryEnabled || this.cancelled.has(cameraId) || this.pendingRecovery.has(cameraId)) return;
    if (!this.captureIsActive(cameraId)) {
      this.recordRecovery(cameraId, "skipped", "Capture is no longer active; relay was not restarted.");
      return;
    }
    const now = Date.now();
    const previous = this.retryCounts.get(cameraId);
    const state = previous && now - previous.firstAt < this.retryWindowMs ? previous : { attempts: 0, firstAt: now };
    if (state.attempts >= this.retryLimit) {
      this.recordRecovery(cameraId, "exhausted", "Retry budget exhausted; manual intervention required.");
      console.error(`YouTube relay [${cameraId}]: recovery limit reached; manual intervention required.`);
      return;
    }
    const delay = this.retryDelaysMs[state.attempts];
    state.attempts++;
    this.retryCounts.set(cameraId, state);
    this.recordRecovery(cameraId, "scheduled", `Retry ${state.attempts}/${this.retryLimit} in ${delay / 1000}s.`);
    this.recoveryDueAt.set(cameraId, new Date(now + delay).toISOString());
    const generation = this.relayGeneration.get(cameraId) ?? 0;
    const timer = setTimeout(() => {
      this.pendingRecovery.delete(cameraId);
      this.recoveryDueAt.delete(cameraId);
      if (this.cancelled.has(cameraId) || this.relayGeneration.get(cameraId) !== generation || this.sessions.has(cameraId)) return;
      if (!this.captureIsActive(cameraId)) {
        this.recordRecovery(cameraId, "skipped", "Capture stopped before retry; no relay started.");
        return;
      }
      this.recordRecovery(cameraId, "attempt", `Starting retry ${state.attempts}/${this.retryLimit}.`);
      try { this.start(cameraId, streamKey, true); }
      catch (error) {
        this.recordRecovery(cameraId, "failed", "Failed to start relay retry.");
        console.error(`YouTube relay [${cameraId}]: recovery failed: ${sanitizeRelayError(error instanceof Error ? error.message : String(error), streamKey)}`);
        this.scheduleRecovery(cameraId, streamKey);
      }
    }, delay);
    timer.unref?.();
    this.pendingRecovery.set(cameraId, timer);
  }

  list() {
    return [...this.sessions.values()].map(({ cameraId, startedAt, status, lastProgressAt, error }) => ({
      cameraId, startedAt, status, lastProgressAt,
      progressAgeMs: lastProgressAt === null ? null : Date.now() - lastProgressAt,
      error,
      transport: "rtmps",
      progressFrame: this.sessions.get(cameraId)?.lastProgressFrame ?? 0,
      outputTimeUs: this.sessions.get(cameraId)?.lastProgressOutTimeUs ?? 0,
      // Local FFmpeg progress is not confirmation of YouTube ingest or viewer playback.
      youtubeVerified: false,
      relayHealth: relayHealth(status, lastProgressAt),
      lastExit: this.lastExits.get(cameraId) ?? null
    }));
  }

  lastExit(cameraId: string) { return this.lastExits.get(cameraId) ?? null; }

  get(cameraId: string) {
    return this.list().find((item) => item.cameraId === cameraId);
  }

  start(cameraId: string, streamKey: string, recovering = false): void {
    if (!recovering) { this.cancelRecovery(cameraId); this.cancelled.delete(cameraId); }
    if (!cameraId.trim()) throw new Error("Camera ID is required.");
    if (this.sessions.has(cameraId)) throw new Error("Stream already running.");
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(streamKey)) {
      throw new Error("Invalid stream key format.");
    }
    this.lastExits.delete(cameraId);
    const url = `rtmps://a.rtmps.youtube.com/live2/${streamKey}`;
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-thread_queue_size", "1024",
      "-f", "mpegts",
      "-i", `udp://127.0.0.1:${streamPort(cameraId)}?fifo_size=1000000&overrun_nonfatal=1`,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy", "-c:a", "copy",
      "-f", "flv",
      "-progress", "pipe:1",
      url
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    const session: StreamSession = {
      cameraId, child, startedAt: new Date().toISOString(),
      status: "connecting", lastProgressAt: null, error: null, stopping: false,
      stopPromise: null, lastProgressFrame: 0, lastProgressOutTimeUs: 0,
      retryCount: this.retryCounts.get(cameraId)?.attempts ?? 0, retryTimer: null, streamKey, generation: Date.now()
    };
    this.sessions.set(cameraId, session);
    guardFfmpegPipes(child, error => { if (!session.stopping) session.error = sanitizeRelayError(error.message, streamKey); });

    let progressBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("frame=")) {
          const frame = Number(line.slice(6));
          if (Number.isFinite(frame)) session.lastProgressFrame = frame;
        }
        if (line.startsWith("out_time_ms=") || line.startsWith("out_time_us=")) {
          const value = Number(line.slice(line.indexOf("=") + 1));
          if (value > 0) {
            session.lastProgressOutTimeUs = value;
            session.lastProgressAt = Date.now();
            if (session.status !== "live" && session.retryCount > 0) {
              this.recordRecovery(cameraId, "reconnected", "FFmpeg resumed local output; YouTube ingest remains unverified.");
            }
            session.status = "live";
          }
        }
      }
    });
    // A UDP MPEG-TS subscriber can join between H.264 keyframes. During
    // startup, FFmpeg may report missing PPS/slice data until the next IDR.
    // These messages are expected only before the first successful output.
    let stderrBuffer = "";
    let ignoredStartupDecoderLines = 0;
    const startupAt = Date.now();
    const startupDecoderMessage = /(?:non-existing PPS \d+ referenced|decode_slice_header error|no frame!|Last message repeated \d+ times|last message repeated \d+ times)/i;
    const reportRelayLine = (rawLine: string) => {
      // Never expose the stream key, even if FFmpeg includes it in a URL.
      const line = sanitizeRelayError(rawLine, streamKey).trim();
      if (!line) return;
      const duringStartup = session.lastProgressAt === null && Date.now() - startupAt < 15000;
      if (duringStartup && startupDecoderMessage.test(line)) {
        ignoredStartupDecoderLines++;
        return;
      }
      // FFmpeg progress/encoder statistics are diagnostics, not relay failures.
      if (/^(?:frame=|fps=|stream_\d+_\d+_q=|\[?\s*progress=)/i.test(line)) return;
      session.error = line.slice(-300);
      console.error(`YouTube relay [${cameraId}]: ${session.error}`);
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) reportRelayLine(line);
      // Bound memory if FFmpeg writes a very long line without a newline.
      if (stderrBuffer.length > 8192) {
        reportRelayLine(stderrBuffer);
        stderrBuffer = "";
      }
    });
    child.on("error", (error) => {
      session.error = sanitizeRelayError(error.message, streamKey);
      session.status = "error";
      // The close event still owns cleanup and recovery scheduling.
    });
    child.on("close", (code) => {
      if (stderrBuffer.trim()) reportRelayLine(stderrBuffer);
      if (ignoredStartupDecoderLines > 0) console.info(`YouTube relay [${cameraId}]: ignored ${ignoredStartupDecoderLines} expected startup decoder messages.`);
      this.lastExits.set(cameraId, { at: new Date().toISOString(), code, error: session.error });
      if (this.sessions.get(cameraId) === session) this.sessions.delete(cameraId);
      if (!session.stopping) {
        console.error(`YouTube relay stopped [${cameraId}], code ${code}`);
        this.scheduleRecovery(cameraId, streamKey);
      }
    });
  }

  async stop(cameraId: string): Promise<boolean> {
    const hadPendingRecovery = this.pendingRecovery.has(cameraId);
    this.cancelRecovery(cameraId);
    const session = this.sessions.get(cameraId);
    if (!session) return hadPendingRecovery;
    if (session.stopPromise) { await session.stopPromise; return true; }
    session.stopping = true;
    session.stopPromise = new Promise<void>((resolve, reject) => {
      let finished = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(softTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (error) reject(error); else resolve();
      };
      const softTimer = setTimeout(() => {
        session.child.kill();
        hardTimer = setTimeout(() => finish(new Error("YouTube relay did not exit after termination.")), 5000);
      }, 4000);
      session.child.once("close", () => finish());
      if (session.child.exitCode !== null || session.child.signalCode !== null) {
        finish();
      } else if (session.child.stdin.writable) {
        session.child.stdin.write("q\n", (error) => { if (error && !finished) session.child.kill(); });
      } else session.child.kill();
    });
    try { await session.stopPromise; }
    finally {
      if ((session.child.exitCode !== null || session.child.signalCode !== null) && this.sessions.get(cameraId) === session) this.sessions.delete(cameraId);
      else if (this.sessions.get(cameraId) === session) session.stopPromise = null;
    }
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...new Set([...this.sessions.keys(), ...this.pendingRecovery.keys()])].map((id) => this.stop(id)));
  }
}
