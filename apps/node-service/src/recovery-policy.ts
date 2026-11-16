// Persistent, explicitly opt-in automatic capture recovery policy.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface RecoveryPolicy {
  enabled: boolean;
  unhealthyChecks: number;
  minimumCaptureAgeSeconds: number;
  protectedStreams: true;
}
const filename = path.join(process.cwd(), "data", "capture-recovery-policy.json");
const defaults: RecoveryPolicy = {
  enabled: false,
  unhealthyChecks: 3,
  minimumCaptureAgeSeconds: 30,
  protectedStreams: true
};
export function readRecoveryPolicy(): RecoveryPolicy {
  try {
    const data: unknown = JSON.parse(readFileSync(filename, "utf8"));
    if (!data || typeof data !== "object") return { ...defaults };
    const value = data as Partial<RecoveryPolicy>;
    return {
      enabled: value.enabled === true,
      unhealthyChecks: Number.isInteger(value.unhealthyChecks) && (value.unhealthyChecks ?? 0) >= 3 && (value.unhealthyChecks ?? 0) <= 12 ? value.unhealthyChecks! : defaults.unhealthyChecks,
      minimumCaptureAgeSeconds: Number.isInteger(value.minimumCaptureAgeSeconds) && (value.minimumCaptureAgeSeconds ?? 0) >= 30 && (value.minimumCaptureAgeSeconds ?? 0) <= 600 ? value.minimumCaptureAgeSeconds! : defaults.minimumCaptureAgeSeconds,
      protectedStreams: true
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Unable to read recovery policy:", error);
    return { ...defaults };
  }
}
export function saveRecoveryPolicy(policy: RecoveryPolicy): void {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.tmp`;
  writeFileSync(temp, JSON.stringify(policy, null, 2), "utf8");
  renameSync(temp, filename);
}
