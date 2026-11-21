import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);

// A process-wide conservative restart interlock. An FFmpeg process may be
// recording from another project: false positives are safer than duplicates.
export function classifyRestartRisk({platform,processes,probeError}) {
  if (probeError) return {safe:false,reason:'PROCESS_ENUMERATION_FAILED',details:String(probeError)};
  if (platform!=='win32') return {safe:false,reason:'WINDOWS_ONLY_PROCESS_INTERLOCK'};
  if (!Array.isArray(processes)) return {safe:false,reason:'INVALID_PROCESS_SNAPSHOT'};
  const ffmpeg=processes.filter(p=>typeof p?.name==='string' && /^ffmpeg(?:\.exe)?$/i.test(p.name));
  if (ffmpeg.length) return {safe:false,reason:'FFMPEG_PROCESS_STILL_RUNNING',pids:ffmpeg.map(p=>p.pid)};
  return {safe:true,reason:'NO_FFMPEG_PROCESSES_DETECTED'};
}
export async function checkCaptureRestartSafety(opts={}) {
  const platform=opts.platform??process.platform;
  if (platform!=='win32') return classifyRestartRisk({platform});
  try {
    const runner=opts.runner??execFileAsync;
    const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { [PSCustomObject]@{name=$_.Name;pid=$_.ProcessId} }) | ConvertTo-Json -Compress"],
      {timeout:12000,maxBuffer:256*1024,windowsHide:true});
    const raw=stdout.trim();
    const parsed=raw?JSON.parse(raw):[];
    return classifyRestartRisk({platform,processes:Array.isArray(parsed)?parsed:parsed?[parsed]:[]});
  } catch(error) {return classifyRestartRisk({platform,probeError:error});}
}
