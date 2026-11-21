import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";

/** Opt-in until DirectShow/NVENC throughput has been accepted on the event hardware. */
export function switchableRecordingEnabled(env = process.env): boolean {
  return env.TOURNAMENT_DYNAMIC_RECORDING === "1" && (env.TSM_DISTRIBUTED_CAPTURE !== "1" || env.TSM_DISTRIBUTED_DYNAMIC_RECORDING === "1");
}
export function recordingSinkArgs(pattern: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-f", "mpegts", "-probesize", "500000", "-analyzeduration", "1000000", "-i", "pipe:0",
    "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-f", "segment", "-segment_time", "300",
    "-segment_format", "matroska", "-reset_timestamps", "1", "-flush_packets", "1", pattern];
}
interface Sink {
  child: ChildProcessWithoutNullStreams; path: string; closing: boolean; reason: string | null;
  requestedStop: boolean; closed: Promise<boolean>; ready: boolean;
}
/** Drains the capture's dedicated, recording-quality TS output continuously. Disk
 * backpressure terminates only the sink, never the camera or YouTube relay. */
export class SwitchableRecording {
  private server: Server | null = null;
  private socket: Socket | null = null;
  private sink: Sink | null = null;
  private starting = false;
  private disposed = false;
  private connectionLost = false;
  async listen(): Promise<string> {
    if (this.server || this.disposed) throw new Error("Recording tap already initialized.");
    const server = createServer(socket => {
      if (this.socket || this.disposed) { socket.destroy(); return; }
      this.socket = socket;
      socket.on("data", (chunk: Buffer) => {
        const sink = this.sink;
        if (!sink || sink.closing) return;
        try {
          if (!sink.child.stdin.writable || sink.child.stdin.writableLength + chunk.length > 4 * 1024 * 1024) {
            this.failSink("Recording sink fell behind; capture and relay were left running.");
          } else { sink.child.stdin.write(chunk); }
        } catch { this.failSink("Recording sink input failed."); }
      });
      socket.on("error", () => { /* close handles cleanup */ });
      socket.once("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.connectionLost = true;
        if (!this.sink?.requestedStop) this.failSink("Recording transport disconnected.");
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    server.on("error", () => { this.connectionLost = true; this.failSink("Recording transport failed."); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate recording transport.");
    return `tcp://127.0.0.1:${address.port}`;
  }
  private failSink(reason: string): void {
    const sink = this.sink;
    if (!sink || sink.closing) return;
    sink.reason = reason; sink.closing = true;
    sink.child.stdin.destroy(); sink.child.kill();
  }
  async start(directory: string, onExit: (path: string, success: boolean, detail: string) => void): Promise<string> {
    if (this.starting || this.sink || this.disposed || this.connectionLost || !this.server) throw new Error("Recording output is unavailable or already active.");
    this.starting = true;
    try {
      await mkdir(directory, { recursive: true });
      if (this.disposed || this.connectionLost) throw new Error("Recording transport has stopped.");
      const prefix = new Date().toISOString().replace(/[:.]/g, "-") + "_" + randomUUID();
      const pattern = path.join(directory, `${prefix}_%04d.mkv`);
      const first = pattern.replace("%04d", "0000");
      const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", recordingSinkArgs(pattern), { windowsHide: true });
      child.stdout.resume(); child.stderr.resume();
      let resolveClose!: (success: boolean) => void;
      const closed = new Promise<boolean>(resolve => { resolveClose = resolve; });
      const sink: Sink = {child, path: first, closing: false, reason: null, requestedStop: false, closed, ready: false};
      this.sink = sink;
      child.stdin.on("error", () => { if (this.sink === sink && !sink.closing) this.failSink("Recording sink stdin failed."); });
      child.on("error", () => { sink.reason = "FFmpeg recording sink could not start."; });
      child.once("close", code => {
        const success = sink.requestedStop && code === 0 && !sink.reason;
        if (this.sink === sink) this.sink = null;
        resolveClose(success);
        if (sink.ready) onExit(first, success, sink.reason || (success ? "Recording finalized." : "Recording sink exited unexpectedly."));
      });
      // MPEG-TS repeats program tables and keyframes. Do not claim recording
      // until a real output file appears, rather than just a spawned process.
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && this.sink === sink && !sink.closing) {
        const info = await stat(first).catch(() => null);
        if (this.sink !== sink || sink.closing) break;
        if (info?.isFile() && info.size > 0) { sink.ready = true; return first; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.sink === sink) { this.failSink("Recording output did not become ready."); await this.waitForClose(sink); }
      throw new Error("Recording output did not become ready. The camera and relay were not restarted.");
    } finally { this.starting = false; }
  }
  private async waitForClose(sink: Sink): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([sink.closed, new Promise<boolean>((_resolve, reject) => {
        timer = setTimeout(() => { sink.reason = "Recording sink finalization timed out."; sink.child.kill(); reject(new Error(sink.reason)); }, 15000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async stop(): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    if (!sink.closing) { sink.requestedStop = true; sink.closing = true; sink.child.stdin.end(); }
    if (!await this.waitForClose(sink)) throw new Error(sink.reason || "Recording could not be finalized cleanly.");
  }
  /** Called on capture exit, not normal recording stop. */
  dispose(): void {
    this.disposed = true;
    this.failSink("Camera capture stopped.");
    this.socket?.destroy(); this.socket = null;
    this.server?.close(); this.server = null;
  }
}
