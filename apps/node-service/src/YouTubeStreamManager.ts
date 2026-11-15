import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { streamPort } from "./stream-port.js";

type StreamSession = {
  cameraId: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  status: "connecting" | "live" | "error";
  lastProgressAt: number | null;
  error: string | null;
  stopping: boolean;
};

export class YouTubeStreamManager {
  private sessions = new Map<string, StreamSession>();

  list() {
    return [...this.sessions.values()].map(({ cameraId, startedAt, status, lastProgressAt, error }) => ({
      cameraId, startedAt, status, lastProgressAt,
      progressAgeMs: lastProgressAt === null ? null : Date.now() - lastProgressAt,
      error
    }));
  }

  get(cameraId: string) {
    return this.list().find((item) => item.cameraId === cameraId);
  }

  start(cameraId: string, streamKey: string): void {
    if (this.sessions.has(cameraId)) throw new Error("Stream already running.");
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(streamKey)) {
      throw new Error("Invalid stream key format.");
    }
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
      status: "connecting", lastProgressAt: null, error: null, stopping: false
    };
    this.sessions.set(cameraId, session);

    let progressBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      progressBuffer += chunk.toString();
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("out_time_ms=") || line.startsWith("out_time_us=")) {
          const value = Number(line.slice(line.indexOf("=") + 1));
          if (value > 0) {
            session.lastProgressAt = Date.now();
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
      const line = rawLine.replaceAll(streamKey, "[REDACTED]").trim();
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
      session.error = error.message.replaceAll(streamKey, "[REDACTED]");
      session.status = "error";
    });
    child.on("close", (code) => {
      if (stderrBuffer.trim()) reportRelayLine(stderrBuffer);
      if (ignoredStartupDecoderLines > 0) console.info(`YouTube relay [${cameraId}]: ignored ${ignoredStartupDecoderLines} expected startup decoder messages.`);
      if (this.sessions.get(cameraId) === session) this.sessions.delete(cameraId);
      if (!session.stopping) console.error(`YouTube relay stopped [${cameraId}], code ${code}`);
    });
  }

  async stop(cameraId: string): Promise<boolean> {
    const session = this.sessions.get(cameraId);
    if (!session) return false;
    session.stopping = true;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { session.child.kill(); finish(); }, 4000);
      session.child.once("close", finish);
      if (session.child.stdin.writable) session.child.stdin.write("q\n");
      else session.child.kill();
    });
    if (this.sessions.get(cameraId) === session) this.sessions.delete(cameraId);
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }
}
