import { open, mkdir, rm, statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import path from "node:path";

const MiB = 1024 * 1024;
export interface StoragePlan {
  cameras: number;
  recordingMbpsPerCamera: number;
  streamMbpsPerCamera: number;
  hours: number;
  safetyFactor: number;
}
export function validateStoragePlan(raw: Partial<StoragePlan>): StoragePlan {
  const plan = {
    cameras: raw.cameras ?? 8,
    recordingMbpsPerCamera: raw.recordingMbpsPerCamera ?? 8,
    streamMbpsPerCamera: raw.streamMbpsPerCamera ?? 6,
    hours: raw.hours ?? 10,
    safetyFactor: raw.safetyFactor ?? 1.5
  };
  const ranges: [keyof StoragePlan,number,number][] = [
    ["cameras",1,128],["recordingMbpsPerCamera",0.1,250],
    ["streamMbpsPerCamera",0,100],["hours",0.1,72],["safetyFactor",1,4]
  ];
  for (const [key,min,max] of ranges)
    if (!Number.isFinite(plan[key]) || plan[key] < min || plan[key] > max)
      throw new Error(`${key} must be between ${min} and ${max}`);
  if (!Number.isInteger(plan.cameras)) throw new Error("cameras must be an integer");
  return plan;
}
export function calculateStoragePlan(plan: StoragePlan, freeBytes?: number, measuredWriteMiBps?: number) {
  const writeMiBps = plan.cameras * plan.recordingMbpsPerCamera / 8 / 1.048576;
  const recommendedWriteMiBps = writeMiBps * plan.safetyFactor;
  const estimatedBytes = plan.cameras * plan.recordingMbpsPerCamera * 1e6 / 8 * plan.hours * 3600;
  const reservedBytes = estimatedBytes * plan.safetyFactor;
  const uploadMbps = plan.cameras * plan.streamMbpsPerCamera;
  return {
    ...plan, estimatedBytes, reservedBytes, writeMiBps, recommendedWriteMiBps,
    uploadMbps, recommendedUploadMbps: uploadMbps * plan.safetyFactor,
    capacityEnough: freeBytes === undefined ? null : freeBytes >= reservedBytes,
    throughputEnough: measuredWriteMiBps === undefined ? null : measuredWriteMiBps >= recommendedWriteMiBps,
    freeBytes: freeBytes ?? null, measuredWriteMiBps: measuredWriteMiBps ?? null,
    note: "Bitrate-based estimate, not a guarantee. Real capture, USB, encoding and upload must be soak tested."
  };
}
export interface DiskBenchmarkResult {
  checkedAt: string;
  sampleMiB: number;
  elapsedSeconds: number;
  measuredWriteMiBps: number;
  directory: string;
  freeBytesAfter: number;
  method: "sequential-temporary-file-fsync";
}
export async function measureRecordingDisk(directory: string, sampleMiB=64): Promise<DiskBenchmarkResult> {
  if (!Number.isInteger(sampleMiB) || sampleMiB < 16 || sampleMiB > 256)
    throw new Error("sampleMiB must be 16 to 256");
  await mkdir(directory,{recursive:true});
  const before=await statfs(directory,{bigint:true});
  const free=Number(before.bavail * before.bsize);
  if (free < (sampleMiB + 512)*MiB) throw new Error("Insufficient free space for safe benchmark");
  const temp=path.join(directory,`.tsm-write-test-${randomUUID()}.tmp`);
  const chunk=Buffer.allocUnsafe(MiB);
  chunk.fill(0x5a); // predictable bytes; benchmark measures sequential write and fsync, not compression
  let file: Awaited<ReturnType<typeof open>> | undefined;
  const start=performance.now();
  try {
    file=await open(temp,"wx",0o600);
    for(let i=0;i<sampleMiB;i++) {
      let offset=0;
      while(offset<chunk.length) {
        const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);
        if(bytesWritten<=0) throw new Error("Disk write made no progress");
        offset+=bytesWritten;
      }
    }
    await file.sync();
  } finally {
    if(file) await file.close();
    await rm(temp,{force:true});
  }
  const elapsedSeconds=Math.max((performance.now()-start)/1000,0.001);
  const after=await statfs(directory,{bigint:true});
  return {
    checkedAt:new Date().toISOString(), sampleMiB,elapsedSeconds,
    measuredWriteMiBps:sampleMiB/elapsedSeconds,directory,
    freeBytesAfter:Number(after.bavail*after.bsize),
    method:"sequential-temporary-file-fsync"
  };
}
