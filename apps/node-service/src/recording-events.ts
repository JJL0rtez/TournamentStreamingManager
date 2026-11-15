import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type RecordingEventType = "recording_started" | "recording_stopped" | "recording_failed";
export interface RecordingEvent {
  timestamp: string;
  type: RecordingEventType;
  cameraId: string;
  recordingPath?: string;
  detail?: string;
}

const events: RecordingEvent[] = [];
const logDirectory = path.resolve(process.cwd(), "data", "logs");
const logFile = path.join(logDirectory, "recording-events.jsonl");
let writes: Promise<void> = Promise.resolve();

export function recordEvent(event: Omit<RecordingEvent, "timestamp">): void {
  const item: RecordingEvent = { timestamp: new Date().toISOString(), ...event };
  events.push(item);
  if (events.length > 250) events.shift();
  // Serialize writes and keep logging failures from crashing capture processes.
  writes = writes.catch(() => {}).then(async () => {
    await mkdir(logDirectory, { recursive: true });
    await appendFile(logFile, JSON.stringify(item) + "\n", "utf8");
  }).catch((error: unknown) => console.error("Recording event log write failed:", error));
}

export function recentRecordingEvents(): RecordingEvent[] {
  return [...events].reverse();
}
