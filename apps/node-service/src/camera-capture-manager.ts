import { validateCaptureOwnership } from "./capture-contract.js";
import { resolveOverlayImage } from "./overlay-assets.js";
import { getCameraQuality } from "./camera-quality-settings.js";
import { probeCameraCapabilities, selectCameraMode, type CameraMode } from "./camera-capabilities.js";
import { getSession } from "./tournament-session.js";
import { recordHistory } from "./recording-history.js";
import { recordEvent } from "./recording-events.js";

import { CameraCapture } from "./camera-capture.js";



export interface ManagedCapture {
  cameraId: string;
  cameraName: string;
  cameraDeviceId: string;
  microphoneName: string;
  recordingEnabled: boolean;
  recordingPath: string;
  startedAt: string;
  capture: CameraCapture;
  selectedMode?: CameraMode;
  configuredQuality?: ReturnType<typeof getCameraQuality>;
  captureConfiguration?: {
    requested: ReturnType<typeof getCameraQuality>;
    actualInput: { width: number; height: number; fps: number; format: string };
    source: "recording-start";
  };
  eventId?: string;
  eventName?: string;
  ring?: string;
}



export class CameraCaptureManager {
  private captures = new Map<string, ManagedCapture>();
  private pendingCameras = new Set<string>();
  private pendingMicrophones = new Set<string>();
  private stoppingCaptures = new Map<string, Promise<void>>();
  private expectedStops = new Set<string>();




async start(
  cameraId: string,
  cameraName: string,
  cameraDeviceId: string,
  microphoneName: string,
  outputDirectory: string,
  recordingEnabled = true
): Promise<ManagedCapture> {

    if (this.stoppingCaptures.has(cameraId)) throw new Error(`Capture ${cameraId} is stopping.`);
    validateCaptureOwnership(cameraId, cameraDeviceId, microphoneName,
      [...this.captures.values()], this.pendingCameras, this.pendingMicrophones);

    this.pendingCameras.add(cameraDeviceId);
    this.pendingMicrophones.add(microphoneName);

    const capture = new CameraCapture();

    try {
      // Query the camera before opening the recording process. Do not silently
      // claim 60 fps when the device only advertises 30 fps.
      const capabilities = await probeCameraCapabilities(cameraName);
      const quality = getCameraQuality(cameraId);
      const requestedFps = quality.fps;
      const supported = capabilities.modes.filter(m => m.width === quality.width && m.height === quality.height && m.fps <= requestedFps + 0.01);
      const selectedMode = supported.sort((a, b) => b.fps - a.fps)[0] || null;
      if (capabilities.detected && !selectedMode) {
        throw new Error(`Camera ${cameraName} does not advertise a supported ${quality.width}x${quality.height} MJPEG mode at or below ${requestedFps} fps.`);
      }
      if (!capabilities.detected) {
        console.warn(`Camera capability detection unavailable for ${cameraName}: ${capabilities.error}. Using configured ${requestedFps} fps; FFmpeg will verify support on startup.`);
      }
      const captureConfiguration = {
        requested: { ...quality },
        actualInput: {
          width: selectedMode?.width ?? quality.width,
          height: selectedMode?.height ?? quality.height,
          fps: selectedMode?.fps ?? quality.fps,
          format: "mjpeg"
        },
        source: "recording-start" as const
      };
      const recordingPath = await capture.start({
        cameraId,
        inputWidth: selectedMode?.width ?? quality.width,
        inputHeight: selectedMode?.height ?? quality.height,
        inputFps: selectedMode?.fps ?? quality.fps,
        recordingBitrate: `${quality.recordingBitrateMbps}M`,
        streamingBitrate: `${quality.streamingBitrateKbps}k`,
        cameraName,
        cameraDeviceId,
        microphoneName,
        outputDirectory,
        recordingEnabled,
        audioSyncOffsetMs: getSession()?.assignments.find(a => a.cameraId === cameraId)?.audioSyncOffsetMs ?? -300,
        overlays: (() => { const assignment = getSession()?.assignments.find(a => a.cameraId === cameraId); return (assignment?.overlays ?? (assignment?.overlay ? [assignment.overlay] : [])).map(overlay => ({ ...overlay, imagePath: resolveOverlayImage(overlay.imageId) })); })()
      });

      await capture.waitUntilReady();


      // Snapshot the tournament and ring when the recording starts. Future
      // assignment changes must not rewrite historical attribution.
      const tournament = getSession();
      const eventName = tournament?.eventName?.trim() || undefined;
      const ring = tournament?.assignments.find(a => a.cameraId === cameraId)?.ring;
      const eventId = tournament?.eventId;
      const managed: ManagedCapture = {
        cameraId,
        cameraName,
        cameraDeviceId,
        microphoneName,
        recordingPath,
        recordingEnabled,
        startedAt: new Date().toISOString(),
        eventId, eventName, ring,
        capture,
        configuredQuality: quality,
        captureConfiguration,
        selectedMode: selectedMode || undefined
      };



capture.onExit(() => {
  if (this.captures.get(cameraId)?.capture === capture) {
    this.captures.delete(cameraId);
    const expected = this.expectedStops.has(cameraId);
    if (recordingEnabled) recordHistory({ cameraId, cameraName, recordingPath: managed.recordingPath,
      startedAt: managed.startedAt, eventId, eventName, ring, captureConfiguration, endedAt: new Date().toISOString(), outcome: expected ? "stopped" : "failed" });
    if (recordingEnabled) recordEvent({ type: expected ? "recording_stopped" : "recording_failed", cameraId,
      recordingPath: managed.recordingPath,
      detail: expected ? "Stopped by operator" : "FFmpeg exited unexpectedly; recording was not automatically restarted" });
    console.log(`Capture ${cameraId} removed after FFmpeg exit.`);
  }
});

if (!capture.isRunning) {
  throw new Error(
    `Capture ${cameraId} stopped before registration completed.`
  );
}

this.captures.set(cameraId, managed);
if (recordingEnabled) recordHistory({ cameraId, cameraName, recordingPath, startedAt: managed.startedAt, eventId, eventName, ring, captureConfiguration, outcome: "started" });

return managed;

    } catch (error) {
      await capture.stop().catch((stopError) => console.error("Capture startup cleanup failed:", stopError));
      throw error;
    } finally {
      this.pendingCameras.delete(cameraDeviceId);
      this.pendingMicrophones.delete(microphoneName);
    }
  }

  get(cameraId: string): ManagedCapture | null {
    return this.captures.get(cameraId) ?? null;
  }

  list(): ManagedCapture[] {
    return [...this.captures.values()];
  }


async stop(cameraId: string): Promise<void> {
  const existingStop = this.stoppingCaptures.get(cameraId);

  if (existingStop) {
    await existingStop;
    return;
  }

  const managed = this.captures.get(cameraId);

  if (!managed) {
    return;
  }

  const stopPromise = (async () => {
    this.expectedStops.add(cameraId);
    try {
      await managed.capture.stop();
    } finally {
      this.captures.delete(cameraId);
      this.expectedStops.delete(cameraId);
    }
  })();

  this.stoppingCaptures.set(cameraId, stopPromise);

  try {
    await stopPromise;
  } finally {
    this.stoppingCaptures.delete(cameraId);
  }
}

async stopAll(): Promise<void> {
  const cameraIds = [...this.captures.keys()];

  await Promise.all(
    cameraIds.map((cameraId) => this.stop(cameraId))
  );
}

}
