import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeCameraDisconnections } from "./camera-health-history.js";

export interface UsbWarningThresholds {
  minimumDisconnects: number;
  minimumCompletedOutages: number;
  maximumObservedDowntimeSeconds: number;
  maximumSingleOutageSeconds: number;
}
export const defaultUsbThresholds: UsbWarningThresholds = {
  minimumDisconnects: 3,
  minimumCompletedOutages: 2,
  maximumObservedDowntimeSeconds: 120,
  maximumSingleOutageSeconds: 90
};
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "usb-reliability-thresholds.json");
let queue: Promise<unknown> = Promise.resolve();
export function validateUsbThresholds(value: unknown): UsbWarningThresholds {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected threshold object");
  const obj = value as Record<string, unknown>;
  const result = {} as UsbWarningThresholds;
  const ranges: Array<[keyof UsbWarningThresholds, number, number]> = [
    ["minimumDisconnects", 1, 1000], ["minimumCompletedOutages", 1, 1000],
    ["maximumObservedDowntimeSeconds", 1, 86400], ["maximumSingleOutageSeconds", 1, 86400]
  ];
  for (const [key, min, max] of ranges) {
    const n = obj[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    result[key] = n;
  }
  return result;
}
export async function readUsbThresholds(): Promise<UsbWarningThresholds> {
  await queue;
  try { return validateUsbThresholds(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("USB reliability settings invalid or unreadable; using defaults:", error);
    return { ...defaultUsbThresholds };
  }
}
export async function saveUsbThresholds(input: unknown) {
  const settings = validateUsbThresholds(input);
  const operation = queue.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(settings, null, 2), "utf8");
    await rename(tmp, file);
    return settings;
  });
  queue = operation.catch(() => {});
  return operation;
}
export async function getUsbReliabilityWarnings() {
  const [thresholds, analysis] = await Promise.all([readUsbThresholds(), analyzeCameraDisconnections()]);
  const warnings = analysis.cameras.flatMap(camera => {
    const reasons: string[] = [];
    if (camera.disconnects >= thresholds.minimumDisconnects)
      reasons.push(`${camera.disconnects} observed disconnects`);
    if (camera.completedOutages >= thresholds.minimumCompletedOutages)
      reasons.push(`${camera.completedOutages} completed outages`);
    if (camera.observedDowntimeMs >= thresholds.maximumObservedDowntimeSeconds * 1000)
      reasons.push(`${Math.round(camera.observedDowntimeMs / 1000)} seconds observed downtime`);
    if (camera.longestCompletedOutageMs >= thresholds.maximumSingleOutageSeconds * 1000)
      reasons.push(`${Math.round(camera.longestCompletedOutageMs / 1000)} seconds longest completed outage`);
    if (camera.currentlyDisconnected) reasons.push("Camera currently disconnected");
    return reasons.length ? [{ cameraId: camera.cameraId, cameraName: camera.cameraName,
      severity: camera.currentlyDisconnected ? "critical" as const : "warning" as const,
      reasons, currentlyDisconnected: camera.currentlyDisconnected }] : [];
  });
  return { checkedAt: analysis.checkedAt, thresholds, warnings,
    trackedCameras: analysis.cameras.length, retainedEvents: analysis.retainedEvents,
    note: "Warnings use sampled history (30-second polling, last 1,000 transitions). Counts are not event-scoped. Device ID changes and missed outages can affect results. A currently disconnected camera is always flagged. These warnings do not prove a USB fault." };
}
