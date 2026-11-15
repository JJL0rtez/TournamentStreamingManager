import { spawn } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import { inspectRecordingSegments } from "./recording-history.js";

export interface SegmentProbe {
  name: string;
  status: "ok" | "invalid" | "unavailable";
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  issue?: string;
}

function probeFile(file: string): Promise<{ streams?: Array<{codec_type?: string; codec_name?: string}>; format?: {duration?: string} }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
      "-of", "json", file
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); finish(new Error("FFprobe timed out after 15 seconds")); }, 15000);
    function finish(error?: Error, result?: any) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(result);
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) { child.kill(); finish(new Error("FFprobe output exceeded limit")); }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) { finish(new Error(stderr || `FFprobe exited with code ${code}`)); return; }
      try { finish(undefined, JSON.parse(stdout)); }
      catch { finish(new Error("Invalid FFprobe JSON output")); }
    });
  });
}

// On-demand only. Active recordings are not probed while FFmpeg writes to them.
export async function validateRecordingSegments(recordingPath: string, maxSegments = 40) {
  const inspection = await inspectRecordingSegments(recordingPath, false);
  if (!Array.isArray(inspection.segments)) return { status: "unknown", issues: inspection.issues, segments: [] };
  const selected = inspection.segments.slice(0, maxSegments);
  const segments: SegmentProbe[] = [];
  for (const segment of selected) {
    const file = path.join(path.dirname(recordingPath), segment.name);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size === 0) throw new Error("Segment is empty or not a file");
      const result = await probeFile(file);
      const video = result.streams?.find(stream => stream.codec_type === "video");
      const audio = result.streams?.find(stream => stream.codec_type === "audio");
      if (!video) throw new Error("No video stream detected");
      segments.push({ name: segment.name, status: "ok", videoCodec: video.codec_name,
        audioCodec: audio?.codec_name, durationSeconds: Number(result.format?.duration) || undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      segments.push({ name: segment.name, status: /ENOENT|spawn ffprobe/i.test(message) ? "unavailable" : "invalid", issue: message });
    }
  }
  const issues = [...inspection.issues, ...segments.filter(s => s.issue).map(s => `${s.name}: ${s.issue}`)];
  if (inspection.segments.length > maxSegments) issues.push(`Only first ${maxSegments} segments checked; run a full check later`);
  return { status: issues.length ? "warning" : "ok", issues, segments,
    checked: segments.length, total: inspection.segments.length,
    note: "FFprobe verifies container metadata and media streams; it does not decode every frame." };
}
