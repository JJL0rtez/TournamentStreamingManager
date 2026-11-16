import { streamPort } from "./stream-port.js";

/** Capture and relay must use the same logical camera ID, not a DirectShow device name. */
export function captureTransportPort(cameraId: string, deviceId?: string): number {
  if (!cameraId.trim()) throw new Error("Camera ID is required for streaming.");
  void deviceId;
  return streamPort(cameraId);
}

/** Reserve physical cameras, microphones and transport ports independently. */
export function validateCaptureOwnership(
  cameraId: string, deviceId: string, microphone: string,
  active: ReadonlyArray<{ cameraId: string; cameraDeviceId: string; microphoneName: string }>,
  pendingDevices: ReadonlySet<string>, pendingMicrophones: ReadonlySet<string>
): void {
  if (active.some(item => item.cameraId === cameraId)) throw new Error("Capture already active.");
  if (pendingDevices.has(deviceId) || active.some(item => item.cameraDeviceId === deviceId)) throw new Error("Camera already in use.");
  if (pendingMicrophones.has(microphone) || active.some(item => item.microphoneName === microphone)) throw new Error("Microphone already in use.");
  if (active.some(item => streamPort(item.cameraId) === streamPort(cameraId))) throw new Error("UDP port collision.");
}
