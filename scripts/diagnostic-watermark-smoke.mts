import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diagnosticSampleArgs } from "../apps/node-service/src/diagnostic-watermark.ts";

const dir=mkdtempSync(path.join(tmpdir(),"tsm-watermark-"));
try {
  const output=path.join(dir,"watermarked.mkv");
  const args=diagnosticSampleArgs({
    inputArgs:["-f","lavfi","-i","testsrc2=size=320x180:rate=10"],
    outputFile:output,durationSeconds:2
  });
  const result=spawnSync(process.env.FFMPEG_PATH||"ffmpeg",args,{encoding:"utf8",timeout:30000});
  if(result.status!==0) throw new Error(result.stderr||`FFmpeg exit ${result.status}`);
  console.log("PASS: FFmpeg encoded a diagnostic video with burned-in overlays");
} finally { rmSync(dir,{recursive:true,force:true}); }
