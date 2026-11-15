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
    child.stderr.on("data", (chunk: Buffer) => {
      // FFmpeg errors may contain the output URL and stream key. Never log raw stderr.
      const message = chunk.toString().replaceAll(streamKey, "[REDACTED]");
      session.error = message.trim().slice(-300) || "FFmpeg relay error";
      console.error(`YouTube relay [${cameraId}]: ${session.error}`);
    });
    child.on("error", (error) => {
      session.error = error.message.replaceAll(streamKey, "[REDACTED]");
      session.status = "error";
    });
    child.on("close", (code) => {
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
