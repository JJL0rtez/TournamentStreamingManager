/** End-to-end synthetic FFmpeg watermark verification. No webcam or stream key needed. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { diagnosticSampleArgs } from "../apps/node-service/src/diagnostic-watermark.ts";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const run = (exe: string, args: string[]) => {
  const result = spawnSync(exe, args, { encoding: "utf8", timeout: 45000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${exe} failed: ${result.error?.message || result.stderr?.slice(-2000)}`);
  return result.stdout;
};
const dir = mkdtempSync(path.join(tmpdir(), "tsm-diag-verify-"));
try {
  const source = "color=c=black:s=640x360:r=10:d=3";
  const clean = path.join(dir, "clean.mkv");
  const marked = path.join(dir, "marked.mkv");
  run(ffmpeg, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", source, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", clean]);
  run(ffmpeg, diagnosticSampleArgs({inputArgs:["-f", "lavfi", "-i", source], outputFile:marked, durationSeconds:3}));
  assert.ok(statSync(marked).size > 2000, "Watermarked file is unexpectedly small");
  const info = JSON.parse(run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", marked]));
  assert.equal(info.streams[0].codec_name, "h264");
  assert.equal(info.streams[0].width, 640);
  assert.equal(info.streams[0].height, 360);
  const frameHash = (file: string, second: number) => run(ffmpeg, ["-v", "error", "-ss", String(second), "-i", file, "-frames:v", "1", "-f", "framemd5", "-"]).split("\n").find(line => line && !line.startsWith("#"))?.split(",").at(-1)?.trim();
  const cleanA = frameHash(clean, 0.3), cleanB = frameHash(clean, 2.3);
  const markedA = frameHash(marked, 0.3), markedB = frameHash(marked, 2.3);
  assert.ok(cleanA && cleanB && markedA && markedB, "Decoded frame hash missing");
  assert.equal(cleanA, cleanB, "Static baseline should not change between frames");
  assert.notEqual(cleanA, markedA, "Burned-in overlay did not change the video pixels");
  assert.notEqual(markedA, markedB, "Moving watermark did not change between frames");
  console.log("PASS: diagnostic file encodes, decodes, differs from clean source, and watermark moves");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
