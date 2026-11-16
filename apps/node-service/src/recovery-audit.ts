// Persistent bounded audit of recovery actions. Audit writes never control camera operations.
import fs from "node:fs";
import path from "node:path";
export interface RecoveryAuditEntry { type: "failure" | "success" | "acknowledged" | "resolved" | "reopened"; cameraId: string; at: string; detail: string }
const filename = path.resolve(process.cwd(), "data", "capture-recovery-audit.json");
const LIMIT = 2000;
export function readRecoveryAudit(): RecoveryAuditEntry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecoveryAuditEntry => !!entry && typeof entry === "object" &&
      ["failure", "success", "acknowledged", "resolved", "reopened"].includes(entry.type) &&
      typeof entry.cameraId === "string" && typeof entry.at === "string" && typeof entry.detail === "string").slice(-LIMIT);
  } catch { return []; }
}
export function appendRecoveryAudit(entry: RecoveryAuditEntry): void {
  const entries = [...readRecoveryAudit(), entry].slice(-LIMIT);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), "utf8");
  fs.renameSync(temporary, filename);
}
