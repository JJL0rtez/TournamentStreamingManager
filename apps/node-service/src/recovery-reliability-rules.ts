import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RecoveryReliabilityRules = {
  minAttempts: number; warningSuccessRate: number; criticalSuccessRate: number;
  warningFailures: number; criticalFailures: number;
};
export const defaultRecoveryReliabilityRules: RecoveryReliabilityRules = {
  minAttempts: 3, warningSuccessRate: 80, criticalSuccessRate: 50,
  warningFailures: 2, criticalFailures: 4
};
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/capture-reliability-rules.json");
const historyFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/capture-reliability-rules-history.json");
export type ReliabilityRuleChange = { id: string; at: string; before: RecoveryReliabilityRules; after: RecoveryReliabilityRules; note: string };
async function readHistoryUnsafe(): Promise<ReliabilityRuleChange[]> {
  try { const value: unknown = JSON.parse(await readFile(historyFile, "utf8")); return Array.isArray(value) ? value as ReliabilityRuleChange[] : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function readRecoveryReliabilityRuleHistory(): Promise<ReliabilityRuleChange[]> { return serialize(async () => (await readHistoryUnsafe()).slice().reverse()); }
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = pending.then(task, task);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
function validate(value: unknown): RecoveryReliabilityRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected threshold settings object");
  const obj = value as Record<string, unknown>;
  const ranges: Record<keyof RecoveryReliabilityRules, [number, number]> = {
    minAttempts: [1, 100], warningSuccessRate: [0, 100], criticalSuccessRate: [0, 100],
    warningFailures: [1, 100], criticalFailures: [1, 100]
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = obj[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}: expected integer ${min}-${max}`);
  }
  if ((obj.criticalSuccessRate as number) > (obj.warningSuccessRate as number)) throw new Error("Critical success-rate threshold must not exceed warning threshold");
  if ((obj.criticalFailures as number) < (obj.warningFailures as number)) throw new Error("Critical failure threshold must not be below warning threshold");
  return Object.fromEntries(Object.keys(ranges).map(key => [key, obj[key]])) as RecoveryReliabilityRules;
}
export type VersionedReliabilityRules = { rules: RecoveryReliabilityRules; version: number };
export class ReliabilityRuleConflict extends Error {
  constructor(public readonly current: VersionedReliabilityRules) { super("Reliability thresholds changed on another dashboard. Reload the current settings before saving."); }
}
async function readCurrentUnsafe(): Promise<VersionedReliabilityRules> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "rules" in raw) {
      const entry = raw as Record<string, unknown>;
      if (!Number.isSafeInteger(entry.version) || (entry.version as number) < 1) throw new Error("Invalid reliability rules version");
      return { rules: validate(entry.rules), version: entry.version as number };
    }
    // Step 129/130 stored a bare rules object. Treat it as version 1 until first write.
    return { rules: validate(raw), version: 1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { rules: { ...defaultRecoveryReliabilityRules }, version: 1 };
    throw error;
  }
}
export function readVersionedRecoveryReliabilityRules(): Promise<VersionedReliabilityRules> {
  return serialize(readCurrentUnsafe);
}
export function readRecoveryReliabilityRules(): Promise<RecoveryReliabilityRules> {
  return serialize(async () => (await readCurrentUnsafe()).rules);
}
export function saveVersionedRecoveryReliabilityRules(value: unknown, expectedVersion: unknown, note = ""): Promise<VersionedReliabilityRules> {
  return serialize(async () => {
    const current = await readCurrentUnsafe();
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) throw new Error("Expected a positive integer version");
    if (expectedVersion !== current.version) throw new ReliabilityRuleConflict(current);
    const rules = validate(value);
    if (JSON.stringify(current.rules) === JSON.stringify(rules)) return current;
    const updated = { rules, version: current.version + 1 };
    const history = await readHistoryUnsafe();
    history.push({ id: `${Date.now()}-${process.pid}-${history.length}`, at: new Date().toISOString(), before: current.rules, after: rules, note: note.slice(0, 500) });
    await mkdir(path.dirname(file), { recursive: true });
    // Persist history before publishing new version so a successful update always has an audit record.
    const historyTemp = `${historyFile}.${process.pid}.tmp`;
    await writeFile(historyTemp, JSON.stringify(history.slice(-500), null, 2), "utf8");
    await rename(historyTemp, historyFile);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(updated, null, 2), "utf8");
    await rename(temp, file);
    return updated;
  });
}

// Restore a historical snapshot as a new version. The operation is serialized with saves.
export function restoreRecoveryReliabilityRules(changeId: unknown, snapshot: unknown, expectedVersion: unknown): Promise<VersionedReliabilityRules> {
  return serialize(async () => {
    const current = await readCurrentUnsafe();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version) throw new ReliabilityRuleConflict(current);
    if (typeof changeId !== "string" || !changeId || (snapshot !== "before" && snapshot !== "after")) throw new Error("Invalid history selection");
    const history = await readHistoryUnsafe();
    const change = history.find(entry => entry.id === changeId);
    if (!change) throw new Error("Historical configuration not found in retained audit history");
    const rules = validate(change[snapshot]);
    if (JSON.stringify(rules) === JSON.stringify(current.rules)) return current;
    const updated = { rules, version: current.version + 1 };
    const event: ReliabilityRuleChange = { id: `${Date.now()}-${process.pid}-${history.length}`, at: new Date().toISOString(), before: current.rules, after: rules, note: `Restored ${snapshot} snapshot from history event ${changeId}` };
    await mkdir(path.dirname(file), { recursive: true });
    const historyTemp = `${historyFile}.${process.pid}.tmp`;
    await writeFile(historyTemp, JSON.stringify([...history, event].slice(-500), null, 2), "utf8");
    await rename(historyTemp, historyFile);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(updated, null, 2), "utf8");
    await rename(temp, file);
    return updated;
  });
}
