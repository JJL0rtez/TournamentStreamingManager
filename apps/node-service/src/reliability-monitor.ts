import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReliabilityThresholds = { minCompleted: number; minFailed: number; minFailureRatePercent: number };
export type KnownCameraIssue = { cameraId: string; note: string; updatedAt: string };
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "reliability-monitor.json");
const defaults: ReliabilityThresholds = { minCompleted: 5, minFailed: 2, minFailureRatePercent: 20 };
type Store = { thresholds: ReliabilityThresholds; issues: KnownCameraIssue[] };
let queue: Promise<void> = Promise.resolve();
export function validateThresholds(value: unknown): ReliabilityThresholds {
  if (!value || typeof value !== "object") throw new Error("Thresholds object required");
  const input = value as Record<string, unknown>;
  const ranges: Array<[keyof ReliabilityThresholds, number, number]> = [
    ["minCompleted", 1, 200], ["minFailed", 1, 200], ["minFailureRatePercent", 1, 100]
  ];
  const output = {} as ReliabilityThresholds;
  for (const [key, min, max] of ranges) {
    const n = input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || !Number.isInteger(n)) {
      throw new Error(`${key} must be an integer from ${min} to ${max}`);
    }
    output[key] = n;
  }
  return output;
}
export async function readReliabilitySettings(): Promise<Store> {
  await queue;
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as Partial<Store>;
    const thresholds = validateThresholds(data.thresholds);
    const issues = Array.isArray(data.issues) ? data.issues.filter(i => i &&
      typeof i.cameraId === "string" && i.cameraId.length <= 300 &&
      typeof i.note === "string" && i.note.length <= 2000 &&
      typeof i.updatedAt === "string").slice(0, 64) : [];
    return { thresholds, issues };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("Reliability settings unreadable; using defaults:", error);
    return { thresholds: { ...defaults }, issues: [] };
  }
}
async function persist(store: Store): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, file);
}
export async function changeReliabilitySettings(update: (current: Store) => Store): Promise<Store> {
  let result!: Store;
  const action = queue.then(async () => {
    // Read directly to avoid awaiting queue from inside queue.
    let current: Store = { thresholds: { ...defaults }, issues: [] };
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as Partial<Store>;
      current = { thresholds: validateThresholds(data.thresholds), issues: Array.isArray(data.issues) ? data.issues : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    result = update(current);
    await persist(result);
  });
  queue = action.catch(() => {});
  await action;
  return result;
}
