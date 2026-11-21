import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildPreviewFfmpegArgs } from './PreviewFfmpeg.js';
import { guardFfmpegPipes, requestFfmpegQuit } from './ffmpeg-pipes.js';
import { PreviewJpegParser } from './preview-jpeg.js';

type PreviewProcess = {
  child: ChildProcessWithoutNullStreams;
  frame: Buffer | null;
  lastFrameAt: number | null;
  frameCount: number;
  error: string | null;
  stopping: boolean;
  stopPromise?: Promise<void>;
};
const harmlessWarning = /deprecated pixel format used, make sure you did set range correctly/i;
type SpawnPreview = (cameraId: string) => ChildProcessWithoutNullStreams;
const spawnPreview: SpawnPreview = cameraId => spawn(process.env.FFMPEG_PATH || "ffmpeg", buildPreviewFfmpegArgs(cameraId), { windowsHide:true, stdio:["pipe","pipe","pipe"] });
export class PreviewProcessManager {
  constructor(private readonly createProcess: SpawnPreview = spawnPreview) {}
  private processes = new Map<string, PreviewProcess>();
  private errors = new Map<string, string>();
  private rememberError(cameraId: string, message: string) {
    this.errors.delete(cameraId);
    this.errors.set(cameraId, message.slice(-1000));
    if (this.errors.size > 64) this.errors.delete(this.errors.keys().next().value!);
  }
  getFrame(cameraId: string): Buffer | null {
    const session = this.processes.get(cameraId);
    return session && !session.stopping && session.child.exitCode === null && session.child.signalCode === null ? session.frame : null;
  }
  getStats(cameraId: string) {
    const session = this.processes.get(cameraId);
    return {
      frameCount: session?.frameCount ?? 0,
      lastFrameAt: session?.lastFrameAt ?? null,
      frameAgeMs: session?.lastFrameAt == null ? null : Date.now() - session.lastFrameAt,
      error: session?.error ?? this.errors.get(cameraId) ?? null,
      running: !!session && session.child.exitCode === null && session.child.signalCode === null && !session.stopping
    };
  }
  isRunning(cameraId: string): boolean { return this.getStats(cameraId).running; }
  async start(cameraId: string): Promise<void> {
    if (this.processes.has(cameraId)) throw new Error('Camera preview is already starting, running or stopping.');
    this.errors.delete(cameraId);
    const child = this.createProcess(cameraId);
    const session: PreviewProcess = { child, frame:null, lastFrameAt:null, frameCount:0, error:null, stopping:false };
    this.processes.set(cameraId, session);
    guardFfmpegPipes(child, error => { if (!session.stopping) session.error = `Preview pipe failed (${error.message})`; });
    const parser = new PreviewJpegParser();
    child.stdout.on('data', (chunk: Buffer) => {
      if (session.stopping) return;
      parser.push(chunk, frame => { session.frame = frame; session.lastFrameAt = Date.now(); session.frameCount++; });
    });
    let stderr = '';
    const report = (line: string) => {
      if (!line.trim() || harmlessWarning.test(line) || /^Last message repeated \d+ times$/i.test(line.trim())) return;
      session.error = line.slice(-1000);
      console.warn(`Preview FFmpeg [${cameraId}]: ${session.error}`);
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString(); const lines = stderr.split(/\r?\n/); stderr = lines.pop() ?? '';
      for (const line of lines) report(line);
      if (stderr.length > 4096) { report(stderr); stderr = ''; }
    });
    child.on('error', error => { session.error = error.message; });
    child.on('close', (code, signal) => {
      report(stderr);
      if (!session.stopping) {
        const reason = session.error || `FFmpeg preview exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`;
        this.rememberError(cameraId, reason);
        console.warn(`Preview stopped unexpectedly [${cameraId}]: ${reason}`);
      }
      if (this.processes.get(cameraId) === session) this.processes.delete(cameraId);
    });
    try {
      await new Promise<void>((resolve,reject) => {
        let finished = false;
        const timeout = setTimeout(() => finish(new Error('Preview did not produce a JPEG within 12 seconds.')),12000);
        const check = setInterval(() => { if (session.frame && !session.stopping) finish(); },100);
        const onError = (error: Error) => finish(error);
        const onClose = (code: number | null) => finish(new Error(session.error || `FFmpeg exited before preview was ready (${code}).`));
        function finish(error?: Error) {
          if (finished) return; finished = true; clearTimeout(timeout); clearInterval(check);
          child.off('error',onError);child.off('close',onClose);
          if(error)reject(error);else resolve();
        }
        child.once('error',onError);child.once('close',onClose);
      });
    } catch(error) {
      this.rememberError(cameraId,error instanceof Error?error.message:String(error));
      await this.stop(cameraId);throw error;
    }
  }
  async stop(cameraId:string):Promise<boolean> {
    const session=this.processes.get(cameraId); if(!session)return false;
    if(session.stopPromise){await session.stopPromise;return true;}
    session.stopping=true;const child=session.child;
    session.stopPromise=new Promise<void>((resolve,reject)=>{
      let finished=false;let hard:ReturnType<typeof setTimeout>|undefined;
      const finish=(error?:Error)=>{
        if(finished)return;finished=true;clearTimeout(soft);if(hard)clearTimeout(hard);child.off('close',closed);
        if(error)reject(error);else resolve();
      };
      const closed=()=>finish();
      const soft=setTimeout(()=>{child.kill();hard=setTimeout(()=>finish(new Error('Preview has not released the camera after termination. Retry stop before reopening it.')),5000);},3000);
      child.once('close',closed);
      if(child.exitCode!==null||child.signalCode!==null){finish();return;}
      requestFfmpegQuit(child);
    });
    try{await session.stopPromise;}
    finally{
      if(child.exitCode!==null||child.signalCode!==null){if(this.processes.get(cameraId)===session)this.processes.delete(cameraId);}
      else if(this.processes.get(cameraId)===session)session.stopPromise=undefined;
    }
    this.errors.delete(cameraId);return true;
  }
}
