import { getRecordingHistory } from "./recording-history.js";
import { readCameraHealthHistory } from "./camera-health-history.js";

/** Bounded, observed-event summary. No inference about unobserved downtime. */
export async function summarizeCameraReliability() {
  const [sessions, health] = await Promise.all([
    getRecordingHistory(200), readCameraHealthHistory(1000)
  ]);
  type Row = { cameraId: string; cameraName: string; recordings: number; completed: number;
    failures: number; activeOrUnknown: number; usbDisconnects: number; usbReconnects: number;
    lastFailureAt: string | null; lastDisconnectAt: string | null };
  const byId = new Map<string, Row>();
  function row(id: string, name: string): Row {
    let item = byId.get(id);
    if (!item) { item = { cameraId: id, cameraName: name || id, recordings: 0, completed: 0,
      failures: 0, activeOrUnknown: 0, usbDisconnects: 0, usbReconnects: 0,
      lastFailureAt: null, lastDisconnectAt: null }; byId.set(id, item); }
    if (name) item.cameraName = name;
    return item;
  }
  for (const session of sessions) {
    const item = row(session.cameraId, session.cameraName);
    item.recordings++;
    if (session.outcome === "failed") {
      item.failures++;
      const at = session.endedAt || session.startedAt;
      if (!item.lastFailureAt || at > item.lastFailureAt) item.lastFailureAt = at;
    } else if (session.outcome === "stopped") item.completed++;
    else item.activeOrUnknown++;
  }
  for (const event of [...health.events].reverse()) {
    if (event.field !== "connection" || event.previous === null) continue;
    const item = row(event.cameraId, event.cameraName);
    if (event.previous && !event.current) {
      item.usbDisconnects++;
      if (!item.lastDisconnectAt || event.at > item.lastDisconnectAt) item.lastDisconnectAt = event.at;
    } else if (!event.previous && event.current) item.usbReconnects++;
  }
  const cameras = [...byId.values()].sort((a, b) => b.failures - a.failures || b.usbDisconnects - a.usbDisconnects || a.cameraName.localeCompare(b.cameraName));
  return { generatedAt: new Date().toISOString(), cameras,
    totals: { cameras: cameras.length, recordings: sessions.length,
      failedRecordings: cameras.reduce((n, c) => n + c.failures, 0),
      usbDisconnects: cameras.reduce((n, c) => n + c.usbDisconnects, 0) },
    limitations: ["Only the latest 200 recording sessions and 1000 sampled camera health transitions are considered.",
      "Recording failures are journal outcomes; missing journal entries and crashes may be unobserved.",
      "USB disconnect timestamps reflect polling detection, not exact disconnect times.",
      "The failure count is not a failure rate over a common time period. Browser-local troubleshooting worksheets are not included in server totals."] };
}
