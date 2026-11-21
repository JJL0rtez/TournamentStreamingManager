import { statfs } from "node:fs/promises";
import { calculateStoragePlan, measureRecordingDisk, validateStoragePlan } from "./storage-readiness.js";
import type { DiskBenchmarkResult, StoragePlan } from "./storage-readiness.js";

let latest: DiskBenchmarkResult | null=null;
let active: Promise<DiskBenchmarkResult> | null=null;
export function getLastDiskBenchmark(): DiskBenchmarkResult | null { return latest; }
export function diskBenchmarkRunning(): boolean { return active!==null; }
export function startDiskBenchmark(directory:string, sampleMiB:number): Promise<DiskBenchmarkResult> {
  if(active) throw new Error("Disk benchmark already running");
  const job=measureRecordingDisk(directory,sampleMiB);
  active=job;
  void job.then(result=>{latest=result;},()=>{}).finally(()=>{if(active===job)active=null;});
  return job;
}
export async function getStorageReadiness(directory:string, raw:Partial<StoragePlan>) {
  const plan=validateStoragePlan(raw);
  const stats=await statfs(directory,{bigint:true});
  const freeBytes=Number(stats.bavail*stats.bsize);
  const measured=latest?.directory===directory ? latest.measuredWriteMiBps : undefined;
  return {
    checkedAt:new Date().toISOString(),
    directory,
    benchmarkRunning:diskBenchmarkRunning(),
    benchmark:latest?.directory===directory ? latest : null,
    plan:calculateStoragePlan(plan,freeBytes,measured),
    warnings:[
      ...(freeBytes<calculateStoragePlan(plan).reservedBytes ? ["Insufficient free disk space for planned duration and safety margin"] : []),
      ...(measured!==undefined && measured<calculateStoragePlan(plan).recommendedWriteMiBps ? ["Measured sequential disk write speed is below planned sustained recording requirement"] : []),
      ...(!latest ? ["Disk throughput unverified: run a benchmark"] : []),
      "Sequential disk benchmark is not a substitute for simultaneous-camera recording soak test"
    ]
  };
}
