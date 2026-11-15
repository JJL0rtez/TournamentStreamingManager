import { mkdir, appendFile, readFile, stat, rename } from "node:fs/promises";
import path from "node:path";
import { readSystemResources } from "./system-resources.js";

// Capture-node local history, not tied to the browser or a specific operator.
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "resource-history.jsonl");
const MAX_BYTES = 12 * 1024 * 1024;
const RETAIN_LINES = 8000;
let writing: Promise<void> = Promise.resolve();
let sampling = false;
let lastSampleAt: string | null = null;
let lastError: string | null = null;
export function resourceSamplingStatus() {
  return { intervalSeconds: 15, lastSampleAt, lastError, retention: "8000 readings or 12 MiB, whichever limit is reached first" };
}
export async function sampleRecordingResources(activeCameraIds: string[]) {
  if (sampling || !activeCameraIds.length) return;
  sampling = true;
  try {
    const snapshot = await readSystemResources();
    const row = { ...snapshot, activeCameraIds: [...new Set(activeCameraIds)].slice(0, 16) };
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(row) + "\n", "utf8");
      const info = await stat(file);
      if (info.size > MAX_BYTES) {
        const data = await readFile(file, "utf8");
        const lines = data.split("\n").filter(Boolean).slice(-RETAIN_LINES);
        const temporary = file + ".tmp";
        const { writeFile } = await import("node:fs/promises");
        await writeFile(temporary, lines.join("\n") + "\n", "utf8");
        await rename(temporary, file);
      }
    });
    await writing;
    lastSampleAt = snapshot.checkedAt;
    lastError = null;
  } catch (error) { lastError = String(error); }
  finally { sampling = false; }
}
export async function getResourceHistory(start: string, end: string, limit = 2000) {
  await writing.catch(() => {});
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > 7 * 86400000)
    throw new Error("Invalid time window: maximum 7 days");
  let content: string;
  try { content = await readFile(file, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const rows: Array<Awaited<ReturnType<typeof readSystemResources>> & { activeCameraIds: string[] }> = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      const t = Date.parse(item.checkedAt);
      if (Number.isFinite(t) && t >= startMs && t <= endMs && Array.isArray(item.activeCameraIds)) rows.push(item);
    } catch { /* ignore partial or corrupt rows */ }
  }
  return rows.slice(-Math.min(5000, Math.max(1, limit)));
}
