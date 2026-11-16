import { streamPort } from "./stream-port.js";

export interface RelayPreflightInput {
  cameraId: string;
  captureRunning: boolean;
  captureDevicePresent: boolean;
  streamKeyConfigured: boolean;
  relayActive: boolean;
  otherCameraIds: readonly string[];
}
export type RelayPreflightResult = {
  ready: boolean;
  checks: { id: string; ok: boolean; message: string }[];
  transportPort: number | null;
  youtubeVerified: false;
};

/** Pure, non-invasive local checks. Never returns a stream key or probes YouTube. */
export function evaluateRelayPreflight(input: RelayPreflightInput): RelayPreflightResult {
  const cameraId = input.cameraId.trim();
  const validId = cameraId.length > 0 && cameraId.length <= 1024;
  const port = validId ? streamPort(cameraId) : null;
  const checks = [
    { id: "camera-id", ok: validId, message: validId ? "Camera ID selected" : "Select a valid camera" },
    { id: "capture-present", ok: input.captureDevicePresent, message: input.captureDevicePresent ? "Camera capture registered" : "Camera capture not registered" },
    { id: "capture-running", ok: input.captureRunning, message: input.captureRunning ? "Local capture running" : "Start local recording first" },
    { id: "stream-key", ok: input.streamKeyConfigured, message: input.streamKeyConfigured ? "Stream key configured" : "Configure a YouTube stream key" },
    { id: "relay-idle", ok: !input.relayActive, message: input.relayActive ? "YouTube relay already active" : "Relay available" },
    { id: "transport-port", ok: port !== null && !input.otherCameraIds.some(id => id !== cameraId && streamPort(id) === port), message: "Camera UDP port must be unique" }
  ];
  return { ready: checks.every(check => check.ok), checks, transportPort: port, youtubeVerified: false };
}
