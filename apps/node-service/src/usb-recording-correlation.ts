import { getRecordingHistory } from "./recording-history.js";
import { readCameraHealthHistory } from "./camera-health-history.js";

/** Correlates sampled disconnect transitions with recording sessions. Never attributes causation. */
export async function analyzeUsbRecordingCorrelation(windowSeconds = 60) {
  const windowMs = Math.min(600, Math.max(0, Math.trunc(windowSeconds))) * 1000;
  const [recordings, health] = await Promise.all([getRecordingHistory(200), readCameraHealthHistory(1000)]);
  const disconnects = health.events.filter(event => event.field === "connection" && event.previous === true && event.current === false)
    .map(event => ({ cameraId: event.cameraId, at: event.at, timestamp: Date.parse(event.at) }))
    .filter(event => Number.isFinite(event.timestamp));
  const rows = recordings.filter(recording => recording.outcome !== "started").map(recording => {
    const start = Date.parse(recording.startedAt);
    const end = recording.endedAt ? Date.parse(recording.endedAt) : NaN;
    const validInterval = Number.isFinite(start) && Number.isFinite(end) && end >= start;
    const matches = validInterval ? disconnects.filter(event => event.cameraId === recording.cameraId &&
      event.timestamp >= start - windowMs && event.timestamp <= end + windowMs) : [];
    return { cameraId: recording.cameraId, cameraName: recording.cameraName, recordingPath: recording.recordingPath,
      startedAt: recording.startedAt, endedAt: recording.endedAt || null, outcome: recording.outcome,
      intervalKnown: validInterval, matchingDisconnects: matches.length, disconnectTimes: matches.map(event => event.at),
      correlated: matches.length > 0 };
  });
  const groups = new Map<string, { cameraId: string; cameraName: string; completed: number; failed: number;
    sessionsWithDisconnect: number; failedWithDisconnect: number; failedWithoutDisconnect: number; unknownIntervals: number }>();
  for (const row of rows) {
    let group = groups.get(row.cameraId);
    if (!group) { group = { cameraId: row.cameraId, cameraName: row.cameraName, completed: 0, failed: 0,
      sessionsWithDisconnect: 0, failedWithDisconnect: 0, failedWithoutDisconnect: 0, unknownIntervals: 0 };
      groups.set(row.cameraId, group); }
    group.completed++;
    if (row.outcome === "failed") group.failed++;
    if (!row.intervalKnown) group.unknownIntervals++;
    else if (row.correlated) {
      group.sessionsWithDisconnect++;
      if (row.outcome === "failed") group.failedWithDisconnect++;
    } else if (row.outcome === "failed") group.failedWithoutDisconnect++;
  }
  return { checkedAt: new Date().toISOString(), windowSeconds: windowMs / 1000,
    retainedHealthEvents: health.totalRetainedEvents, observedDisconnects: disconnects.length,
    sessionsAnalyzed: rows.length, cameras: [...groups.values()].sort((a, b) => b.failedWithDisconnect - a.failedWithDisconnect),
    sessions: rows.filter(row => row.outcome === "failed" || row.correlated).slice(0, 100),
    limitations: ["Correlation does not establish USB disconnection as the cause of recording failure.",
      "Disconnections are sampled approximately every 30 seconds, so short outages may be missed.",
      "Only the latest 200 recording sessions and 1,000 health transitions are considered.",
      "Session matching requires stable Windows camera IDs and valid start/end timestamps.",
      "The comparison window extends before recording start and after recording end, and may match unrelated events.",
      "Sessions with missing end timestamps are excluded from interval correlation."] };
}
