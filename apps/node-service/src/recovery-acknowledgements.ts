// Persistent acknowledgement state for recovery failures. Does not affect recovery policy.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
const filename = path.join(process.cwd(), "data", "capture-recovery-acknowledgements.json");
export const recoveryEventKey = (event: {cameraId: string; at: string; outcome: string}) =>
  `${event.at}|${event.cameraId}|${event.outcome}`;
export function readRecoveryAcknowledgements(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, at]) => key.length < 500 && typeof at === "string"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Unable to read recovery acknowledgements:", error);
    return {};
  }
}
export function saveRecoveryAcknowledgements(value: Record<string, string>): void {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  renameSync(temp, filename);
}
