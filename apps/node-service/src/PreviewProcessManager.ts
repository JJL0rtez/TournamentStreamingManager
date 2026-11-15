import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildPreviewFfmpegArgs } from "./PreviewFfmpeg.js";

type PreviewProcess = {
  child: ChildProcessWithoutNullStreams;
  buffer: Buffer;
  frame: Buffer | null;
  lastFrameAt: number | null;
  frameCount: number;
  error: string | null;
  stopping: boolean;
};

export class PreviewProcessManager {
  private processes = new Map<string, PreviewProcess>();

  getFrame(cameraId: string): Buffer | null {
    return this.processes.get(cameraId)?.frame ?? null;
  }

  getStats(cameraId: string) {
    const session = this.processes.get(cameraId);
    return {
      frameCount: session?.frameCount ?? 0,
      lastFrameAt: session?.lastFrameAt ?? null,
      frameAgeMs: session?.lastFrameAt == null ? null : Date.now() - session.lastFrameAt,
      error: session?.error ?? null,
      running: !!session && session.child.exitCode === null && !session.stopping
    };
  }

  isRunning(cameraId: string): boolean {
    return this.getStats(cameraId).running;
  }

  async start(cameraId: string): Promise<void> {
    if (this.processes.has(cameraId)) {
      throw new Error("Camera preview is already starting or running.");
    }

    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", buildPreviewFfmpegArgs(cameraId), {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session: PreviewProcess = {
      child, buffer: Buffer.alloc(0), frame: null,
      lastFrameAt: null, frameCount: 0, error: null, stopping: false
    };
    this.processes.set(cameraId, session);

    child.stdout.on("data", (chunk: Buffer) => {
      session.buffer = Buffer.concat([session.buffer, chunk]);
      // Guard against unbounded memory growth if FFmpeg emits invalid output.
      if (session.buffer.length > 8 * 1024 * 1024) {
        session.buffer = Buffer.alloc(0);
        return;
      }
      while (true) {
        const start = session.buffer.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) { session.buffer = Buffer.alloc(0); break; }
        const end = session.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) { session.buffer = session.buffer.subarray(start); break; }
        session.frame = Buffer.from(session.buffer.subarray(start, end + 2));
        session.lastFrameAt = Date.now();
        session.frameCount++;
        session.buffer = session.buffer.subarray(end + 2);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        session.error = message.slice(-1000);
        console.error(`Preview FFmpeg [${cameraId}]: ${message}`);
      }
    });
    child.on("error", (error) => { session.error = error.message; });
    child.on("close", () => {
      if (this.processes.get(cameraId) === session) this.processes.delete(cameraId);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error("Preview did not produce a JPEG within 12 seconds.")), 12000);
        const check = setInterval(() => {
          if (session.frame) finish();
        }, 100);
        const onError = (error: Error) => finish(error);
        const onClose = (code: number | null) => finish(new Error(session.error || `FFmpeg exited before preview was ready (${code}).`));
        let finished = false;
        function finish(error?: Error) {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          clearInterval(check);
          child.off("error", onError);
          child.off("close", onClose);
          if (error) reject(error); else resolve();
        }
        child.once("error", onError);
        child.once("close", onClose);
      });
    } catch (error) {
      await this.stop(cameraId);
      throw error;
    }
  }

  async stop(cameraId: string): Promise<boolean> {
    const session = this.processes.get(cameraId);
    if (!session) return false;
    session.stopping = true;
    await new Promise<void>((resolve) => {
      if (session.child.exitCode !== null) { resolve(); return; }
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        session.child.kill();
        done();
      }, 3000);
      session.child.once("close", done);
      if (session.child.stdin.writable) session.child.stdin.write("q\n");
      else session.child.kill();
    });
    if (this.processes.get(cameraId) === session) this.processes.delete(cameraId);
    return true;
  }
}
