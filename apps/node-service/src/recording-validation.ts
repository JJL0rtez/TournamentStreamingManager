import { spawn } from "node:child_process";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { selectSegmentSamples } from "./recording-sampling.js";
import { inspectRecordingSegments } from "./recording-history.js";

export interface SegmentProbe {
  name: string;
  status: "ok" | "invalid" | "unavailable";
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  issue?: string;
}

interface ProbeResult {
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
  format?: { duration?: string };
}

// Bound both runtime and captured output. A broken ffprobe must never hang a request.
// Limit all concurrent validation requests to three FFprobe processes in total.
// This protects live capture from diagnostic bursts in multiple dashboards.
const MAX_CONCURRENT_PROBES = 3;
let activeProbes = 0;
const waiters: Array<() => void> = [];
async function withProbeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeProbes >= MAX_CONCURRENT_PROBES) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  activeProbes++;
  try { return await work(); }
  finally {
    activeProbes--;
    waiters.shift()?.();
  }
}

function probeFile(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
      "-of", "json", file
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("FFprobe timed out after 15 seconds"));
    }, 15000);
    function finish(error?: Error, result?: ProbeResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(result ?? {});
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) {
        child.kill();
        finish(new Error("FFprobe output exceeded limit"));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code !== 0) { finish(new Error(stderr || `FFprobe exited with code ${code}`)); return; }
      try { finish(undefined, JSON.parse(stdout) as ProbeResult); }
      catch { finish(new Error("Invalid FFprobe JSON output")); }
    });
  });
}

/** Validate stopped recordings only; the API checks active capture before calling. */
export async function validateRecordingSegments(recordingPath: string, maxSegments = 40) {
  const inspection = await inspectRecordingSegments(recordingPath, false);
  if (!Array.isArray(inspection.segments)) return { status: "unknown", issues: inspection.issues, segments: [] };
  const selected = selectSegmentSamples(inspection.segments, maxSegments);
  const segments: SegmentProbe[] = await Promise.all(selected.map(async segment => withProbeSlot(async () => {
    const file = path.join(path.dirname(recordingPath), segment.name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new Error("Segment is empty, a symbolic link, or not a regular file");
      }
      const result = await probeFile(file);
      const video = result.streams?.find(stream => stream.codec_type === "video");
      const audio = result.streams?.find(stream => stream.codec_type === "audio");
      if (!video) throw new Error("No video stream detected");
      const duration = Number(result.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Missing or invalid segment duration");
      return { name: segment.name, status: "ok" as const, videoCodec: video.codec_name,
        audioCodec: audio?.codec_name, durationSeconds: duration };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { name: segment.name,
        status: (/ENOENT|spawn ffprobe/i.test(message) ? "unavailable" : "invalid") as SegmentProbe["status"], issue: message };
    }
  })));
  const issues = [...inspection.issues, ...segments.filter(s => s.issue).map(s => `${s.name}: ${s.issue}`)];
  const sampled = inspection.segments.length > selected.length;
  if (sampled) issues.push(`Sampled ${selected.length} of ${inspection.segments.length} segments across the recording; unchecked segments are not verified`);
  return { status: issues.length ? "warning" : "ok", issues, segments,
    checked: segments.length, total: inspection.segments.length, sampled,
    note: "FFprobe checks metadata and streams of selected stopped segments; it does not decode every frame." };
}
