// Persistent operator resolutions. The latest failure timestamp is used to reopen incidents.
import fs from "node:fs";
import path from "node:path";
export interface IncidentResolution { lastFailureAt: string; resolvedAt: string; note: string }
const filename = path.resolve(process.cwd(), "data", "capture-recovery-incidents.json");
export function readIncidentResolutions(): Record<string, IncidentResolution> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, IncidentResolution] => {
      const v = entry[1] as Partial<IncidentResolution> | null;
      return !!v && typeof v.lastFailureAt === "string" && typeof v.resolvedAt === "string" && typeof v.note === "string";
    }));
  } catch { return {}; }
}
export function saveIncidentResolutions(value: Record<string, IncidentResolution>): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filename);
}
