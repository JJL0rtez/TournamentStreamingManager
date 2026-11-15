import fs from "node:fs";
import path from "node:path";

export interface CameraQualityOverride {
  width: number;
  height: number;
  fps: number;
  recordingBitrateMbps: number;
  streamingBitrateKbps: number;
}
const file = path.resolve(process.env.TOURNAMENT_CONFIG_DIR || "config", "camera-quality.json");
const defaultQuality: CameraQualityOverride = {
  width: 1920, height: 1080,
  fps: process.env.TOURNAMENT_CAPTURE_FPS === "60" ? 60 : 30,
  recordingBitrateMbps: 12, streamingBitrateKbps: 4500
};
let overrides: Record<string, CameraQualityOverride> = {};
try {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      try { overrides[id] = validateQuality(value); } catch { console.warn(`Ignoring invalid saved quality settings for ${id}`); }
    }
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Camera quality settings could not be loaded:", error);
}
function validateQuality(input: unknown): CameraQualityOverride {
  if (!input || typeof input !== "object") throw new Error("Quality settings must be an object.");
  const q = input as Record<string, unknown>;
  const number = (key: keyof CameraQualityOverride, min: number, max: number) => {
    const value = q[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`Invalid ${key}; expected ${min} to ${max}.`);
    return value;
  };
  const width = number("width", 320, 3840), height = number("height", 240, 2160);
  const fps = number("fps", 1, 120);
  const recordingBitrateMbps = number("recordingBitrateMbps", 1, 100);
  const streamingBitrateKbps = number("streamingBitrateKbps", 500, 20000);
  if (![width, height, fps, recordingBitrateMbps, streamingBitrateKbps].every(Number.isInteger))
    throw new Error("Quality values must be whole numbers.");
  return { width, height, fps, recordingBitrateMbps, streamingBitrateKbps };
}
export function getCameraQuality(cameraId: string): CameraQualityOverride {
  return { ...(overrides[cameraId] || defaultQuality) };
}
export function listCameraQualityOverrides(): Record<string, CameraQualityOverride> {
  return { ...overrides };
}
export function saveCameraQuality(cameraId: string, input: unknown): CameraQualityOverride {
  if (!cameraId || cameraId.length > 512) throw new Error("Invalid camera ID.");
  const next = validateQuality(input);
  const updated = { ...overrides, [cameraId]: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(updated, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  overrides = updated;
  return next;
}
export function deleteCameraQuality(cameraId: string): void {
  const updated = { ...overrides }; delete updated[cameraId];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(updated, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file); overrides = updated;
}

// Bulk writes are validated in full before replacing the persisted configuration.
export function saveCameraQualityBulk(cameraIds: string[], input: unknown): number {
  if (!Array.isArray(cameraIds) || cameraIds.length < 1 || cameraIds.length > 16 ||
      new Set(cameraIds).size !== cameraIds.length ||
      cameraIds.some(id => typeof id !== "string" || !id || id.length > 512)) {
    throw new Error("Provide 1 to 16 unique camera IDs.");
  }
  const quality = validateQuality(input);
  const updated = { ...overrides };
  for (const id of cameraIds) updated[id] = { ...quality };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(updated, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* no temp to remove */ }
    throw error;
  }
  overrides = updated;
  return cameraIds.length;
}
