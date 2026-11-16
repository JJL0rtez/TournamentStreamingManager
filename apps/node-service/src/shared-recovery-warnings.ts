import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SharedWarning = { key: string; at: string; cameraId: string; from: string; to: string; attempts: number; failures: number; rate: number; reason: string; acknowledgedAt?: string; note?: string };
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/capture-reliability-warnings.json");
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action, action);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
async function load(): Promise<SharedWarning[]> {
  try { const data: unknown = JSON.parse(await readFile(file, "utf8")); return Array.isArray(data) ? data.filter(x => x && typeof x.key === "string").slice(0, 1000) : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function save(events: SharedWarning[]) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(events, null, 2), "utf8");
  await rename(temp, file);
}
export function readSharedWarnings() { return serialize(load); }
export function addSharedWarning(value: unknown): Promise<SharedWarning> { return serialize(async () => {
  const v = value as Partial<SharedWarning> | null;
  if (!v || typeof v.cameraId !== "string" || !v.cameraId.trim() || v.cameraId.length > 200 ||
    !["Normal", "Warning", "Critical"].includes(v.from ?? "") || !["Normal", "Warning", "Critical"].includes(v.to ?? "") || v.from === v.to ||
    typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || Math.abs(Date.now() - Date.parse(v.at)) > 86400000 ||
    ![v.attempts, v.failures, v.rate].every(x => typeof x === "number" && Number.isFinite(x) && x >= 0) ||
    typeof v.reason !== "string" || v.reason.length > 500) throw new Error("Invalid warning transition");
  const key = JSON.stringify([v.at, v.cameraId, v.from, v.to]);
  const events = await load(); const existing = events.find(x => x.key === key);
  if (existing) return existing;
  const event: SharedWarning = { key, at: v.at, cameraId: v.cameraId, from: v.from!, to: v.to!, attempts: v.attempts!, failures: v.failures!, rate: v.rate!, reason: v.reason };
  events.unshift(event); await save(events.slice(0, 1000)); return event;
}); }
export function acknowledgeSharedWarning(key: unknown, note: unknown): Promise<SharedWarning> { return serialize(async () => {
  if (typeof key !== "string" || key.length > 1000 || typeof note !== "string" || !note.trim() || note.trim().length > 1000) throw new Error("Invalid acknowledgement");
  const events = await load(); const event = events.find(x => x.key === key);
  if (!event) throw new Error("Warning not found");
  if (!event.acknowledgedAt) { event.acknowledgedAt = new Date().toISOString(); event.note = note.trim(); await save(events); }
  return event;
}); }
