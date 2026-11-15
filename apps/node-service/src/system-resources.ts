import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commandOptions = { timeout: 3500, windowsHide: true, maxBuffer: 128 * 1024 };

async function run(program: string, args: string[]): Promise<string | null> {
  try { const result = await execFileAsync(program, args, commandOptions); return result.stdout.trim(); }
  catch { return null; }
}

function numberOrNull(value: unknown): number | null {
  const valueNumber = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(valueNumber) && valueNumber >= 0
    ? valueNumber : null;
}

interface WindowsPerf {
  cpuPercent?: number;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
  diskBusyPercent?: number;
}

async function windowsPerf(): Promise<WindowsPerf | null> {
  if (process.platform !== "win32") return null;
  // A single PowerShell process retrieves OS-wide instantaneous formatted counters.
  // These counters can be unavailable or misleading on some storage drivers.
  const script = [
    '$ErrorActionPreference="Stop"',
    '$cpu=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name=\'_Total\'"',
    '$disk=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name=\'_Total\'"',
    '[pscustomobject]@{cpuPercent=$cpu.PercentProcessorTime;diskReadBytesPerSec=$disk.DiskReadBytesPersec;diskWriteBytesPerSec=$disk.DiskWriteBytesPersec;diskBusyPercent=$disk.PercentDiskTime}|ConvertTo-Json -Compress'
  ].join(";");
  const raw = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: WindowsPerf = {};
    for (const key of ["cpuPercent", "diskReadBytesPerSec", "diskWriteBytesPerSec", "diskBusyPercent"] as const) {
      const n = numberOrNull(parsed[key]);
      if (n !== null) result[key] = n;
    }
    return result;
  } catch { return null; }
}

async function nvidiaGpu() {
  const raw = await run("nvidia-smi", ["--query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"]);
  if (!raw) return null;
  const line = raw.split(/\r?\n/)[0];
  const columns = line.split(",").map(value => value.trim());
  if (columns.length !== 6) return null;
  return {
    name: columns[0], utilizationPercent: numberOrNull(columns[1]),
    memoryUtilizationPercent: numberOrNull(columns[2]),
    memoryUsedMiB: numberOrNull(columns[3]), memoryTotalMiB: numberOrNull(columns[4]),
    temperatureC: numberOrNull(columns[5])
  };
}

export async function readSystemResources() {
  const [windows, gpu] = await Promise.all([windowsPerf(), nvidiaGpu()]);
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const processMemory = process.memoryUsage();
  return {
    checkedAt: new Date().toISOString(),
    host: { platform: process.platform, cpuModel: os.cpus()[0]?.model || "Unknown", logicalCores: os.cpus().length },
    cpu: { utilizationPercent: windows?.cpuPercent ?? null, source: windows ? "Windows formatted performance counter" : "Unavailable" },
    memory: { totalBytes: totalMemoryBytes, freeBytes: freeMemoryBytes, usedBytes: usedMemoryBytes,
      nodeRssBytes: processMemory.rss },
    disk: { readBytesPerSec: windows?.diskReadBytesPerSec ?? null,
      writeBytesPerSec: windows?.diskWriteBytesPerSec ?? null,
      busyPercent: windows?.diskBusyPercent ?? null,
      source: windows ? "Windows all-physical-disks aggregate" : "Unavailable" },
    gpu,
    notes: [
      "GPU utilization is NVIDIA device-wide utilization, not NVENC-specific load.",
      "Disk throughput covers all physical disks, not exclusively the recording destination.",
      "CPU and disk counters may be unavailable depending on Windows configuration.",
      "This is a point-in-time diagnostic, not a synchronized stress-test trace."
    ]
  };
}
