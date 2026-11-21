import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type StressResourceReport, type StressResult } from "./dashboard-shared";

export interface SystemResourceSnapshot {
  checkedAt: string;
  host: { platform: string; cpuModel: string; logicalCores: number };
  cpu: { utilizationPercent: number | null; source: string };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; nodeRssBytes: number };
  disk: { readBytesPerSec: number | null; writeBytesPerSec: number | null;
    busyPercent: number | null; source: string };
  gpu: null | { name: string; utilizationPercent: number | null;
    memoryUtilizationPercent: number | null; memoryUsedMiB: number | null;
    memoryTotalMiB: number | null; temperatureC: number | null };
  notes: string[];
}

export function StressResourceSummary({ report, cameraResults }: {
  report: StressResourceReport; cameraResults: StressResult[];
}) {
  const readings = report.readings;
  const summary = (values: Array<number | null | undefined>, suffix: string, scale = 1) => {
    const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!valid.length) return "Unavailable";
    const min = Math.min(...valid) / scale;
    const max = Math.max(...valid) / scale;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length / scale;
    return `${min.toFixed(1)} / ${avg.toFixed(1)} / ${max.toFixed(1)} ${suffix}`;
  };
  const rows = [
    { name: "CPU utilization", values: readings.map(r => r.cpu.utilizationPercent), unit: "%", scale: 1 },
    { name: "RAM used", values: readings.map(r => r.memory.usedBytes), unit: "GiB", scale: 1073741824 },
    { name: "GPU utilization", values: readings.map(r => r.gpu?.utilizationPercent), unit: "%", scale: 1 },
    { name: "GPU memory used", values: readings.map(r => r.gpu?.memoryUsedMiB), unit: "MiB", scale: 1 },
    { name: "Disk write throughput", values: readings.map(r => r.disk.writeBytesPerSec), unit: "MiB/s", scale: 1048576 },
    { name: "Disk busy", values: readings.map(r => r.disk.busyPercent), unit: "%", scale: 1 }
  ];
  const failed = cameraResults.filter(r => r.status === "failed").length;
  const warnings = cameraResults.filter(r => r.status === "warning").length;
  return <div className="bulk-results" aria-label="Stress test system resource report">
    <h3>System resources during the 30-second test</h3>
    <p>{readings.length} resource samples collected; {report.failures} unavailable.
      Camera results: {cameraResults.length - failed - warnings} passed, {warnings} warnings, {failed} failed.</p>
    <table><thead><tr><th>Metric</th><th>Minimum / Average / Maximum</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.name}><td>{row.name}</td>
        <td>{summary(row.values, row.unit, row.scale)}</td></tr>)}
    </tbody></table>
    <details><summary>Individual system readings</summary>
      <table><thead><tr><th>Time</th><th>CPU</th><th>GPU</th><th>Disk write</th></tr></thead><tbody>
        {readings.map((r, index) => <tr key={`${r.checkedAt}-${index}`}>
          <td>{new Date(r.checkedAt).toLocaleTimeString()}</td>
          <td>{r.cpu.utilizationPercent === null ? "N/A" : `${r.cpu.utilizationPercent.toFixed(1)}%`}</td>
          <td>{r.gpu?.utilizationPercent == null ? "N/A" : `${r.gpu.utilizationPercent.toFixed(1)}%`}</td>
          <td>{r.disk.writeBytesPerSec === null ? "N/A" : `${(r.disk.writeBytesPerSec / 1048576).toFixed(1)} MiB/s`}</td>
        </tr>)}
      </tbody></table>
    </details>
    <small>Samples are approximate and may not coincide exactly with camera failures. GPU is device-wide, not NVENC-specific;
      disk counters are system-wide. No automated bottleneck attribution is made. Results remain in this dashboard session only.</small>
  </div>;
}

export function SystemResourceMonitor({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [snapshot, setSnapshot] = useState<SystemResourceSnapshot | null>(null);
  const [history, setHistory] = useState<SystemResourceSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formatPercent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;
  const formatRate = (value: number | null) => value === null ? "Unavailable" : `${(value / 1048576).toFixed(1)} MiB/s`;
  async function sample() {
    setBusy(true); setError("");
    try {
      const result = await requestNode("/api/system/resources") as SystemResourceSnapshot;
      setSnapshot(result);
      setHistory(previous => [...previous.slice(-19), result]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="System resource monitoring">
    <h2>System Resource Snapshot</h2>
    <p>Inspect CPU, memory, NVIDIA GPU, and disk activity while cameras are recording.
      Click repeatedly during a stress test to collect up to 20 local snapshots.</p>
    <button type="button" disabled={busy} onClick={() => void sample()}>
      {busy ? "Sampling resources..." : "Sample System Resources"}</button>
    <button type="button" onClick={() => setHistory([])} disabled={history.length === 0}>Clear Samples</button>
    {error && <p role="alert">Resource sample failed: {error}</p>}
    {snapshot && <>
      <p>Checked: {new Date(snapshot.checkedAt).toLocaleString()}.
        {` ${snapshot.host.cpuModel} (${snapshot.host.logicalCores} logical cores)`}</p>
      <table><thead><tr><th>Metric</th><th>Latest reading</th></tr></thead><tbody>
        <tr><td>CPU utilization</td><td>{formatPercent(snapshot.cpu.utilizationPercent)}</td></tr>
        <tr><td>System RAM used / total</td><td>{(snapshot.memory.usedBytes / 1073741824).toFixed(1)} /
          {(snapshot.memory.totalBytes / 1073741824).toFixed(1)} GiB</td></tr>
        <tr><td>Node service RAM (RSS)</td><td>{(snapshot.memory.nodeRssBytes / 1048576).toFixed(1)} MiB</td></tr>
        <tr><td>Physical disk read</td><td>{formatRate(snapshot.disk.readBytesPerSec)}</td></tr>
        <tr><td>Physical disk write</td><td>{formatRate(snapshot.disk.writeBytesPerSec)}</td></tr>
        <tr><td>Physical disk busy</td><td>{formatPercent(snapshot.disk.busyPercent)}</td></tr>
        <tr><td>NVIDIA GPU</td><td>{snapshot.gpu ? `${snapshot.gpu.name}: ${formatPercent(snapshot.gpu.utilizationPercent)}` : "Unavailable"}</td></tr>
        <tr><td>GPU memory used</td><td>{snapshot.gpu && snapshot.gpu.memoryUsedMiB !== null ?
          `${snapshot.gpu.memoryUsedMiB} MiB` : "Unavailable"}</td></tr>
        <tr><td>GPU temperature</td><td>{snapshot.gpu?.temperatureC !== null && snapshot.gpu?.temperatureC !== undefined ?
          `${snapshot.gpu.temperatureC} °C` : "Unavailable"}</td></tr>
      </tbody></table>
      <p>Collected {history.length} snapshot{history.length === 1 ? "" : "s"} in this browser session.</p>
      {history.length > 1 && <table><thead><tr><th>Sample</th><th>CPU</th><th>GPU</th><th>Disk write</th></tr></thead><tbody>
        {history.map((item, index) => <tr key={`${item.checkedAt}-${index}`}>
          <td>{new Date(item.checkedAt).toLocaleTimeString()}</td>
          <td>{formatPercent(item.cpu.utilizationPercent)}</td>
          <td>{formatPercent(item.gpu?.utilizationPercent ?? null)}</td>
          <td>{formatRate(item.disk.writeBytesPerSec)}</td>
        </tr>)}
      </tbody></table>}
      <p>{snapshot.notes.join(" ")}</p>
    </>}
  </section>;
}
