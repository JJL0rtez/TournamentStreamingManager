import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type CameraHealthState = { cameraId: string; cameraName: string; connected: boolean; recordingActive: boolean };
export type CameraHealthTransition = CameraHealthState & {
  at: string;
  field: "baseline" | "connection" | "recording";
  previous: boolean | null;
  current: boolean;
};
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "camera-health-history.json");
const maxEvents = 1000;
const maxCameras = 64;
let queue: Promise<unknown> = Promise.resolve();
type Store = { version: 1; lastSeen: Record<string, CameraHealthState>; events: CameraHealthTransition[] };
const empty = (): Store => ({ version: 1, lastSeen: {}, events: [] });
async function load(): Promise<Store> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<Store>;
    if (raw.version !== 1 || !Array.isArray(raw.events) || !raw.lastSeen || typeof raw.lastSeen !== "object")
      throw new Error("Unexpected health history format");
    return { version: 1, lastSeen: raw.lastSeen, events: raw.events.slice(-maxEvents) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("Camera health history unreadable; starting a fresh history:", error);
    return empty();
  }
}
async function persist(store: Store) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, file);
}
export async function appendCameraHealthSnapshot(cameras: CameraHealthState[]): Promise<CameraHealthTransition[]> {
  const operation = queue.then(async () => {
    const store = await load();
    const now = new Date().toISOString();
    const events: CameraHealthTransition[] = [];
    const unique = new Map(cameras.filter(c => c.cameraId && c.cameraId.length <= 300)
      .map(c => [c.cameraId, c]));
    // Cameras tracked in a previous successful scan remain tracked after disconnection.
    // The caller MUST NOT call this on discovery failure.
    for (const [id, old] of Object.entries(store.lastSeen)) {
      if (!unique.has(id)) unique.set(id, { ...old, connected: false, recordingActive: false });
    }
    for (const [cameraId, current] of unique) {
      const previous = store.lastSeen[cameraId];
      const normalized = { cameraId, cameraName: current.cameraName || previous?.cameraName || cameraId,
        connected: Boolean(current.connected), recordingActive: Boolean(current.recordingActive) };
      if (!previous) {
        events.push({ ...normalized, at: now, field: "baseline", previous: null, current: normalized.connected });
      } else {
        if (previous.connected !== normalized.connected)
          events.push({ ...normalized, at: now, field: "connection", previous: previous.connected, current: normalized.connected });
        if (previous.recordingActive !== normalized.recordingActive)
          events.push({ ...normalized, at: now, field: "recording", previous: previous.recordingActive, current: normalized.recordingActive });
      }
      store.lastSeen[cameraId] = normalized;
    }
    // Do not grow indefinitely if Windows changes device IDs repeatedly.
    const ids = Object.keys(store.lastSeen);
    for (const id of ids.slice(0, Math.max(0, ids.length - maxCameras))) delete store.lastSeen[id];
    if (events.length) {
      store.events = [...store.events, ...events].slice(-maxEvents);
      await persist(store);
    }
    return events;
  });
  queue = operation.catch(() => {});
  return operation;
}
export async function readCameraHealthHistory(limit = 200) {
  await queue;
  const store = await load();
  const safeLimit = Math.min(1000, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 200)));
  return { events: store.events.slice(-safeLimit).reverse(), trackedCameras: Object.keys(store.lastSeen).length,
    totalRetainedEvents: store.events.length, historyLimit: maxEvents,
    note: "Transitions are sampled, not continuous. Timestamps are detection times, not exact failure times. Baseline means first observed, not a connection change. Discovery errors are not recorded as disconnections." };
}

/** Summarize observed connection transitions. This is not continuous uptime telemetry. */
export async function analyzeCameraDisconnections() {
  await queue;
  const store = await load();
  const checkedAt = new Date().toISOString();
  const byCamera = new Map<string, {
    cameraId: string; cameraName: string; disconnects: number; reconnects: number;
    completedOutages: number; observedDowntimeMs: number;
    longestCompletedOutageMs: number; currentlyDisconnected: boolean;
    openOutageSince: string | null; firstObservedAt: string | null;
  }>();
  for (const [cameraId, state] of Object.entries(store.lastSeen)) {
    byCamera.set(cameraId, { cameraId, cameraName: state.cameraName, disconnects: 0,
      reconnects: 0, completedOutages: 0, observedDowntimeMs: 0,
      longestCompletedOutageMs: 0, currentlyDisconnected: !state.connected,
      openOutageSince: null, firstObservedAt: null });
  }
  const open = new Map<string, number>();
  for (const event of store.events) {
    if (event.field !== "connection" && event.field !== "baseline") continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    let entry = byCamera.get(event.cameraId);
    if (!entry) {
      entry = { cameraId: event.cameraId, cameraName: event.cameraName,
        disconnects: 0, reconnects: 0, completedOutages: 0,
        observedDowntimeMs: 0, longestCompletedOutageMs: 0,
        currentlyDisconnected: false, openOutageSince: null, firstObservedAt: null };
      byCamera.set(event.cameraId, entry);
    }
    if (!entry.firstObservedAt) entry.firstObservedAt = event.at;
    if (event.field === "baseline") {
      // First observation is not evidence of a disconnect. A disconnected baseline
      // begins an interval, but does not increment the disconnection counter.
      if (!event.current) open.set(event.cameraId, at);
    } else if (event.current === false && event.previous === true) {
      entry.disconnects++;
      open.set(event.cameraId, at);
    } else if (event.current === true && event.previous === false) {
      entry.reconnects++;
      const start = open.get(event.cameraId);
      if (start !== undefined && at >= start) {
        const duration = at - start;
        entry.completedOutages++;
        entry.observedDowntimeMs += duration;
        entry.longestCompletedOutageMs = Math.max(entry.longestCompletedOutageMs, duration);
      }
      open.delete(event.cameraId);
    }
  }
  for (const entry of byCamera.values()) {
    const start = open.get(entry.cameraId);
    entry.openOutageSince = start === undefined ? null : new Date(start).toISOString();
  }
  return { checkedAt, retainedEvents: store.events.length, cameras: [...byCamera.values()]
    .sort((a, b) => b.disconnects - a.disconnects || a.cameraName.localeCompare(b.cameraName)),
    note: "Counts and durations are derived only from the last 1,000 sampled transitions. Completed outage durations are approximate (30-second polling), and exclude ongoing outages. A camera first seen disconnected is not counted as a disconnection. History truncation, device-ID changes, service downtime, and discovery errors can undercount outages. Do not interpret these values as full-event uptime percentages." };
}
