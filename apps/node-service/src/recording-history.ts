import { appendFile, mkdir, readFile, readdir, lstat } from "node:fs/promises";
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
  let directoryEntries: string[];
  try { directoryEntries = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "warning", segments: [], issues: ["Recording directory no longer exists"], totalBytes: 0 };
    }
    throw error;
  }
  const names = directoryEntries.filter(name =>
    name.startsWith(prefix) && /^\d{4,}\.mkv$/.test(name.slice(prefix.length))
  ).sort((a, b) => Number(a.slice(prefix.length, -4)) - Number(b.slice(prefix.length, -4)));
  const segments = await Promise.all(names.map(async name => {
    try {
      const info = await lstat(path.join(directory, name));
      return { name, bytes: info.size, modifiedAt: info.mtime.toISOString(),
        index: Number(name.slice(prefix.length, -4)), regularFile: info.isFile() && !info.isSymbolicLink() };
    } catch {
      return { name, bytes: 0, modifiedAt: "", index: Number(name.slice(prefix.length, -4)), regularFile: false };
    }
  }));
  const issues: string[] = [];
  if (!segments.length) issues.push("No segment files found");
  let expectedIndex = 0;
  segments.forEach((segment, i) => {
    if (segment.index > expectedIndex) {
      const missingEnd = segment.index - 1;
      issues.push(expectedIndex === missingEnd
        ? `Missing segment index ${expectedIndex} before ${segment.name}`
        : `Missing segment indices ${expectedIndex}-${missingEnd} before ${segment.name}`);
    }
    if (segment.index !== i) issues.push(`Unexpected segment index ${segment.index} at position ${i}: ${segment.name}`);
    expectedIndex = Math.max(expectedIndex, segment.index + 1);
    if (!segment.regularFile) issues.push(`Not a regular recording file: ${segment.name}`);
    if (segment.bytes === 0 && !(active && i === segments.length - 1 && segment.regularFile)) issues.push(`Empty segment: ${segment.name}`);
  });
  return { status: issues.length ? "warning" : active ? "recording" : "ok", segments, issues,
    totalBytes: segments.reduce((total, segment) => total + segment.bytes, 0),
    note: "Checks file presence, sequence and nonzero size; does not decode media or verify MKV integrity." };
}
