import { getRecordingHistory } from "./recording-history.js";
import { getResourceHistory } from "./resource-history.js";

/** Timestamp proximity only: never infer causation or invent missing measurements. */
export async function analyzeResourceFailureCorrelation(windowSeconds = 120) {
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0 || windowSeconds > 600)
    throw new Error("windowSeconds must be between 0 and 600");
  const margin = Math.trunc(windowSeconds) * 1000;
  const sessions = (await getRecordingHistory(200)).filter(s => s.outcome === "failed");
  const valid = sessions.map(s => ({ session: s, at: Date.parse(s.endedAt || "") }))
    .filter(x => Number.isFinite(x.at));
  const now = Date.now();
  const earliest = Math.max(now - 7 * 86400000, Math.min(now, ...valid.map(x => x.at - margin)));
  const readings = earliest <= now ? await getResourceHistory(new Date(earliest).toISOString(), new Date(now).toISOString(), 5000) : [];
  const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const rows = sessions.map(session => {
    const failedAt = Date.parse(session.endedAt || "");
    const timestampKnown = Number.isFinite(failedAt);
    const inRetention = timestampKnown && failedAt >= now - 7 * 86400000 && failedAt <= now;
    const nearby = inRetention ? readings.filter(reading => {
      const at = Date.parse(reading.checkedAt);
      return Number.isFinite(at) && Math.abs(at - failedAt) <= margin &&
        Array.isArray(reading.activeCameraIds) && reading.activeCameraIds.includes(session.cameraId);
    }) : [];
    const metrics = (reading: (typeof readings)[number]) => ({
      at: reading.checkedAt,
      offsetSeconds: Math.round((Date.parse(reading.checkedAt) - failedAt) / 1000),
      cpuPercent: number(reading.cpu?.utilizationPercent),
      gpuPercent: number(reading.gpu?.utilizationPercent),
      gpuMemoryUsedMiB: number(reading.gpu?.memoryUsedMiB),
      ramUsedGiB: number(reading.memory?.usedBytes) === null ? null : Number((reading.memory.usedBytes / 1073741824).toFixed(2)),
      diskWriteMiBps: number(reading.disk?.writeBytesPerSec) === null ? null : Number((reading.disk.writeBytesPerSec / 1048576).toFixed(2)),
      diskBusyPercent: number(reading.disk?.busyPercent)
    });
    const measured = nearby.map(metrics).sort((a,b) => Math.abs(a.offsetSeconds) - Math.abs(b.offsetSeconds));
    const max = (key: keyof ReturnType<typeof metrics>) => {
      const values = measured.map(x => x[key]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      return values.length ? Math.max(...values) : null;
    };
    return { cameraId: session.cameraId, cameraName: session.cameraName,
      recordingPath: session.recordingPath, failedAt: session.endedAt || null,
      timestampKnown, inRetention, nearbySamples: measured.length,
      closest: measured[0] || null,
      maximumNearby: { cpuPercent: max("cpuPercent"), gpuPercent: max("gpuPercent"),
        ramUsedGiB: max("ramUsedGiB"), diskWriteMiBps: max("diskWriteMiBps"), diskBusyPercent: max("diskBusyPercent") } };
  });
  return { generatedAt: new Date().toISOString(), windowSeconds: Math.trunc(windowSeconds),
    failedSessions: rows.length, failuresWithSamples: rows.filter(x => x.nearbySamples > 0).length,
    resourceSamplesConsidered: readings.length, sessions: rows,
    limitations: [
      "Only failed sessions from the latest 200 recording sessions are analyzed.",
      "Resource history is retained for a limited period and may be truncated; absent samples are unknown, not zero.",
      "Samples are approximately 15 seconds apart while recording and may miss short spikes.",
      "CPU, GPU and disk measurements are host-wide; GPU utilization is not NVENC-specific.",
      "Only samples listing the failing camera as active are matched.",
      "Timestamp proximity does not establish that resource usage caused a recording failure."
    ] };
}
