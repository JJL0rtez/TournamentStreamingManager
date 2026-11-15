import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DiagnosticThresholds {
  cpuPercent: number;
  gpuPercent: number;
  ramPercent: number;
  diskWriteMiBps: number;
  minimumUsbDisconnects: number;
}
export const defaultDiagnosticThresholds: DiagnosticThresholds = {
  cpuPercent: 90, gpuPercent: 95, ramPercent: 90,
  diskWriteMiBps: 150, minimumUsbDisconnects: 1
};
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "diagnostic-thresholds.json");
let pending: Promise<unknown> = Promise.resolve();
export function validateDiagnosticThresholds(value: unknown): DiagnosticThresholds {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected threshold object");
  const obj = value as Record<string, unknown>;
  const ranges: Array<[keyof DiagnosticThresholds, number, number]> = [
    ["cpuPercent", 1, 100], ["gpuPercent", 1, 100], ["ramPercent", 1, 100],
    ["diskWriteMiBps", 1, 100000], ["minimumUsbDisconnects", 1, 100]
  ];
  const result = {} as DiagnosticThresholds;
  for (const [key, min, max] of ranges) {
    const n = obj[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max ||
      (key === "minimumUsbDisconnects" && !Number.isInteger(n)))
      throw new Error(`${key} must be a ${key === "minimumUsbDisconnects" ? "whole number" : "number"} from ${min} to ${max}`);
    result[key] = n;
  }
  return result;
}
export async function readDiagnosticThresholds(): Promise<DiagnosticThresholds> {
  await pending;
  try { return validateDiagnosticThresholds(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("Diagnostic thresholds unreadable; using defaults:", error);
    return { ...defaultDiagnosticThresholds };
  }
}
export async function saveDiagnosticThresholds(value: unknown) {
  const settings = validateDiagnosticThresholds(value);
  const operation = pending.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
    await rename(tmp, file);
    return settings;
  });
  pending = operation.catch(() => {});
  return operation;
}
