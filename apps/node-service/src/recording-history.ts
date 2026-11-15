import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface RecordingHistoryEntry {
  cameraId: string;
  cameraName: string;
  recordingPath: string;
  startedAt: string;
  eventId?: string;
  eventName?: string;
  ring?: string;
  endedAt?: string;
  outcome: "started" | "stopped" | "failed";
  // Immutable recording-start snapshot, preserved across later stop/failure events.
  captureConfiguration?: {
    requested: { width: number; height: number; fps: number; recordingBitrateMbps: number; streamingBitrateKbps: number };
    actualInput: { width: number; height: number; fps: number; format: string };
    source: "recording-start";
  };
}

// JSONL survives process restarts. Writes are queued to preserve event order.
const historyFile = path.resolve(process.cwd(), "recordings", "recording-history.jsonl");
let pending: Promise<void> = Promise.resolve();
export function recordHistory(entry: RecordingHistoryEntry): void {
  pending = pending.catch(() => {}).then(async () => {
    await mkdir(path.dirname(historyFile), { recursive: true });
    await appendFile(historyFile, JSON.stringify(entry) + "\n", "utf8");
  });
  void pending.catch(error => console.error("Could not save recording history:", error));
}

export async function getRecordingHistory(limit = 50) {
  await pending.catch(() => {});
  let contents: string;
  try { contents = await readFile(historyFile, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const rows: RecordingHistoryEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as RecordingHistoryEntry;
      if (item.cameraId && item.recordingPath && item.startedAt) rows.push(item);
    } catch { /* ignore truncated final line after power loss */ }
  }
  // Collapse start/stop events into one session; the timestamped path is its ID.
  const sessions = new Map<string, RecordingHistoryEntry>();
  for (const row of rows) sessions.set(row.recordingPath, { ...sessions.get(row.recordingPath), ...row });
  return [...sessions.values()].reverse().slice(0, Math.min(200, Math.max(1, limit)));
}

export async function inspectRecordingSegments(recordingPath: string, active: boolean) {
  const directory = path.dirname(recordingPath);
  const first = path.basename(recordingPath);
  if (!first.endsWith("_0000.mkv")) return { status: "unknown", segments: [], issues: ["Unsupported filename pattern"] };
  const prefix = first.slice(0, -"0000.mkv".length);
  const names = (await readdir(directory)).filter(name =>
    name.startsWith(prefix) && /^\d{4,}\.mkv$/.test(name.slice(prefix.length))
  ).sort((a, b) => Number(a.slice(prefix.length, -4)) - Number(b.slice(prefix.length, -4)));
  const segments = await Promise.all(names.map(async name => {
    const info = await stat(path.join(directory, name));
    return { name, bytes: info.size, modifiedAt: info.mtime.toISOString(),
      index: Number(name.slice(prefix.length, -4)) };
  }));
  const issues: string[] = [];
  if (!segments.length) issues.push("No segment files found");
  segments.forEach((segment, i) => {
    if (segment.index !== i) issues.push(`Missing segment ${String(i).padStart(4, "0")} before ${segment.name}`);
    if (segment.bytes === 0 && !(active && i === segments.length - 1)) issues.push(`Empty segment: ${segment.name}`);
  });
  return { status: issues.length ? "warning" : active ? "recording" : "ok", segments, issues,
    totalBytes: segments.reduce((total, segment) => total + segment.bytes, 0),
    note: "Checks file presence, sequence and nonzero size; does not decode media or verify MKV integrity." };
}
