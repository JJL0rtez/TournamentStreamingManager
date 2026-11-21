import { validateCaptureOwnership } from "./capture-contract.js";
import { streamPort } from "./stream-port.js";
import { resolveOverlayImage } from "./overlay-assets.js";
import { getCameraQuality } from "./camera-quality-settings.js";
import { probeCameraCapabilities, selectCameraMode, type CameraMode } from "./camera-capabilities.js";
import { getSession } from "./tournament-session.js";
import { recordHistory } from "./recording-history.js";
import { recordEvent } from "./recording-events.js";

import { switchableRecordingEnabled } from "./switchable-recording.js";
import { CameraCapture } from "./camera-capture.js";
import { CaptureRecoveryPlanner, recoveryEnabled } from "./capture-recovery-planner.js";



export interface ManagedCapture {
  cameraId: string;
  cameraName: string;
  cameraDeviceId: string;
  microphoneName: string;
  recordingEnabled: boolean;
  recordingStartedAt?: string;
  outputMode: "production" | "diagnostic";
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
  private pendingIds = new Set<string>();
  private pendingStarts = new Map<string, Promise<ManagedCapture>>();
  private pendingPorts = new Set<number>();
  private pendingCameras = new Set<string>();
  private pendingMicrophones = new Set<string>();
  private stoppingCaptures = new Map<string, Promise<void>>();
  private expectedStops = new Set<string>();
  private recordingChanges = new Set<string>();
  private recovery = new CaptureRecoveryPlanner();
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryDueAt = new Map<string, string>();
  private recoveryGeneration = new Map<string, number>();
  private shutdownInProgress = false;
  private readonly recoveryEvents: Array<{ cameraId: string; at: string; type: "scheduled" | "attempt" | "recovered" | "exhausted" | "cancelled" | "failed"; detail: string }> = [];

  private recordRecovery(cameraId: string, type: "scheduled" | "attempt" | "recovered" | "exhausted" | "cancelled" | "failed", detail: string): void {
    this.recoveryEvents.push({ cameraId, type, detail, at: new Date().toISOString() });
    if (this.recoveryEvents.length > 150) this.recoveryEvents.splice(0, this.recoveryEvents.length - 150);
  }
  recoveryEventsSnapshot() { return [...this.recoveryEvents].reverse(); }

  /** Cancel scheduled retries before any operator-initiated lifecycle change. */
  private cancelRecovery(cameraId: string): void {
    const timer = this.recoveryTimers.get(cameraId);
    if (timer) {
      clearTimeout(timer);
      this.recordRecovery(cameraId, "cancelled", "Scheduled capture retry cancelled.");
    }
    this.recoveryTimers.delete(cameraId);
    this.recoveryDueAt.delete(cameraId);
    this.recoveryGeneration.set(cameraId, (this.recoveryGeneration.get(cameraId) ?? 0) + 1);
  }

  /** Recovery is opt-in and limited to a small number of exponentially delayed attempts. */
  private scheduleRecovery(managed: ManagedCapture, outputDirectory: string): void {
    if (!recoveryEnabled() || this.shutdownInProgress || this.expectedStops.has(managed.cameraId) || this.recoveryTimers.has(managed.cameraId)) return;
    const cameraId = managed.cameraId;
    const delay = this.recovery.nextDelay(cameraId, Date.now());
    if (delay === null) {
      this.recordRecovery(cameraId, "exhausted", "Retry budget exhausted; operator intervention required.");
      console.error(`Capture ${cameraId}: automatic recovery exhausted; operator intervention required.`);
      return;
    }
    const generation = this.recoveryGeneration.get(cameraId) ?? 0;
    this.recordRecovery(cameraId, "scheduled", `Capture retry scheduled in ${delay / 1000}s.`);
    console.warn(`Capture ${cameraId}: attempting automatic recovery in ${delay} ms.`);
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(cameraId);
      this.recoveryDueAt.delete(cameraId);
      if (this.shutdownInProgress || this.recoveryGeneration.get(cameraId) !== generation || this.captures.has(cameraId)) return;
      void this.startInternalRecovery(managed, outputDirectory, generation);
    }, delay);
    timer.unref?.();
    this.recoveryTimers.set(cameraId, timer);
    this.recoveryDueAt.set(cameraId, new Date(Date.now() + delay).toISOString());
  }

  private async startInternalRecovery(managed: ManagedCapture, outputDirectory: string, generation: number): Promise<void> {
    try {
      this.recordRecovery(managed.cameraId, "attempt", "Attempting to reopen camera and microphone.");
      const restarted = await this.start(managed.cameraId, managed.cameraName, managed.cameraDeviceId,
        managed.microphoneName, outputDirectory, managed.recordingEnabled, managed.outputMode, true);
      if (this.shutdownInProgress || this.recoveryGeneration.get(managed.cameraId) !== generation) {
        // Stop only the capture opened by this retry, not an operator replacement.
        const current = this.captures.get(managed.cameraId);
        if (current?.capture === restarted.capture) await this.stop(managed.cameraId);
      } else {
        this.recordRecovery(managed.cameraId, "recovered", "FFmpeg capture process started; video and audio quality still require monitoring.");
      }
    } catch (error) {
      this.recordRecovery(managed.cameraId, "failed", "Camera reopening failed; retry policy will determine next action.");
      console.error(`Capture ${managed.cameraId}: recovery attempt failed:`, error);
      if (!this.shutdownInProgress && this.recoveryGeneration.get(managed.cameraId) === generation)
        this.scheduleRecovery(managed, outputDirectory);
    }
  }

  /** Snapshot of recovery state for future dashboard/API integration. */
  recoveryStatus(): Array<{ cameraId: string; attempts: number; pending: boolean; enabled: boolean; nextRetryAt: string | null }> {
    return this.recovery.snapshot().map(entry => ({ ...entry, pending: this.recoveryTimers.has(entry.cameraId),
      enabled: recoveryEnabled(), nextRetryAt: this.recoveryDueAt.get(entry.cameraId) ?? null }));
  }




/** Track startup as a lifecycle operation so stop/stopAll cannot race it. */
start(
  cameraId: string, cameraName: string, cameraDeviceId: string,
  microphoneName: string, outputDirectory: string, recordingEnabled = true,
  outputMode: "production" | "diagnostic" = "production",
  recoveryAttempt = false
): Promise<ManagedCapture> {
  // An operator start supersedes a queued automatic start. Retry attempts
  // deliberately retain the existing retry budget.
  if (!recoveryAttempt && !this.captures.has(cameraId) && !this.pendingStarts.has(cameraId)) {
    this.cancelRecovery(cameraId);
    this.recovery.clear(cameraId);
  }
  if (this.shutdownInProgress) return Promise.reject(new Error("Capture manager is shutting down."));
  if (this.pendingStarts.has(cameraId)) {
    return Promise.reject(new Error(`Capture ${cameraId} is already starting.`));
  }
  const operation = this.startInternal(cameraId, cameraName, cameraDeviceId,
    microphoneName, outputDirectory, recordingEnabled, outputMode);
  this.pendingStarts.set(cameraId, operation);
  // Both successful and failed startups must release their lifecycle entry.
  void operation.then(
    () => { if (this.pendingStarts.get(cameraId) === operation) this.pendingStarts.delete(cameraId); },
    () => { if (this.pendingStarts.get(cameraId) === operation) this.pendingStarts.delete(cameraId); }
  );
  return operation;
}

private async startInternal(
  cameraId: string,
  cameraName: string,
  cameraDeviceId: string,
  microphoneName: string,
  outputDirectory: string,
  recordingEnabled = true,
  outputMode: "production" | "diagnostic" = "production"
): Promise<ManagedCapture> {

    if (!cameraId.trim() || !cameraDeviceId.trim() || !microphoneName.trim()) throw new Error("Capture ID, camera device and microphone are required.");
    if (this.stoppingCaptures.has(cameraId)) throw new Error(`Capture ${cameraId} is stopping.`);
    if (this.pendingIds.has(cameraId)) throw new Error(`Capture ${cameraId} is already starting.`);
    const port = streamPort(cameraId);
    if (this.pendingPorts.has(port)) throw new Error(`Capture transport port ${port} is reserved by another startup.`);
    validateCaptureOwnership(cameraId, cameraDeviceId, microphoneName,
      [...this.captures.values()], this.pendingCameras, this.pendingMicrophones);

    this.pendingIds.add(cameraId);
    this.pendingPorts.add(port);
    this.pendingCameras.add(cameraDeviceId);
    this.pendingMicrophones.add(microphoneName);

    const capture = new CameraCapture();

    try {
      // Query the camera before opening the recording process. Do not silently
      // claim 60 fps when the device only advertises 30 fps.
      const capabilities = await probeCameraCapabilities(cameraDeviceId.startsWith("@device_") ? cameraDeviceId : cameraName);
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
      const dynamicRecording = switchableRecordingEnabled() && outputMode === "production";
      const recordingPath = await capture.start({
        switchableRecording: dynamicRecording,
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
        outputMode,
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
        recordingPath: dynamicRecording || !recordingEnabled ? "" : recordingPath,
        recordingEnabled: recordingEnabled && !dynamicRecording,
        outputMode,
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
    if (recordingEnabled && !dynamicRecording) recordHistory({ cameraId, cameraName, recordingPath: managed.recordingPath,
      startedAt: managed.startedAt, eventId, eventName, ring, captureConfiguration, endedAt: new Date().toISOString(), outcome: expected ? "stopped" : "failed" });
    if (recordingEnabled && !dynamicRecording) recordEvent({ type: expected ? "recording_stopped" : "recording_failed", cameraId,
      recordingPath: managed.recordingPath,
      detail: expected ? "Stopped by operator" : "FFmpeg exited unexpectedly; recording was not automatically restarted" });
    if (!expected && !this.pendingIds.has(cameraId)) this.scheduleRecovery({ ...managed }, outputDirectory);
    console.log(`Capture ${cameraId} removed after FFmpeg exit.`);
  }
});

if (!capture.isRunning) {
  throw new Error(
    `Capture ${cameraId} stopped before registration completed.`
  );
}

this.captures.set(cameraId, managed);
if (dynamicRecording && recordingEnabled) {
  await this.changeRecording(cameraId, true, outputDirectory);
}
if (recordingEnabled && !dynamicRecording) recordHistory({ cameraId, cameraName, recordingPath, startedAt: managed.startedAt, eventId, eventName, ring, captureConfiguration, outcome: "started" });

return managed;

    } catch (error) {
      this.expectedStops.add(cameraId);
      await capture.stop().catch((stopError) => console.error("Capture startup cleanup failed:", stopError));
      this.expectedStops.delete(cameraId);
      throw error;
    } finally {
      this.pendingIds.delete(cameraId);
      this.pendingPorts.delete(port);
      this.pendingCameras.delete(cameraDeviceId);
      this.pendingMicrophones.delete(microphoneName);
    }
  }

  /** Change the disk sink without mutating the capture or relay process. */
  async changeRecording(cameraId: string, enabled: boolean, outputDirectory: string): Promise<void> {
    const managed = this.captures.get(cameraId);
    if (!managed?.capture.isRunning || !managed.capture.supportsRecordingSwitch || managed.outputMode !== "production")
      throw new Error("Independent recording is not supported by this capture.");
    if (this.recordingChanges.has(cameraId) || this.stoppingCaptures.has(cameraId))
      throw new Error("A camera recording operation is already in progress.");
    if (managed.recordingEnabled === enabled) return;
    this.recordingChanges.add(cameraId);
    try {
      if (!enabled) { await managed.capture.stopRecordingOutput(); return; }
      const startedAt = new Date().toISOString();
      const session = getSession();
      const context = { cameraId, cameraName: managed.cameraName, startedAt,
        eventId: session?.eventId, eventName: session?.eventName,
        ring: session?.assignments.find(a => a.cameraId === cameraId)?.ring,
        captureConfiguration: managed.captureConfiguration };
      const recordingPath = await managed.capture.startRecordingOutput(outputDirectory, (path, success, detail) => {
        if (managed.recordingPath === path) {
          managed.recordingEnabled = false; managed.recordingPath = ""; managed.recordingStartedAt = undefined;
        }
        recordHistory({ ...context, recordingPath: path, endedAt: new Date().toISOString(), outcome: success ? "stopped" : "failed" });
        recordEvent({ cameraId, recordingPath: path, type: success ? "recording_stopped" : "recording_failed", detail });
      });
      if (this.captures.get(cameraId) !== managed || !managed.capture.isRunning) throw new Error("Capture stopped while starting recording.");
      managed.recordingPath = recordingPath;
      managed.recordingStartedAt = startedAt;
      managed.recordingEnabled = true;
      recordHistory({ ...context, recordingPath, outcome: "started" });
      recordEvent({ cameraId, recordingPath, type: "recording_started" });
    } finally { this.recordingChanges.delete(cameraId); }
  }

  get(cameraId: string): ManagedCapture | null {
    return this.captures.get(cameraId) ?? null;
  }

  list(): ManagedCapture[] {
    return [...this.captures.values()];
  }


async stop(cameraId: string): Promise<void> {
  this.cancelRecovery(cameraId);
  this.recovery.clear(cameraId);
  const existingStop = this.stoppingCaptures.get(cameraId);

  if (existingStop) {
    await existingStop;
    return;
  }

  // A stop requested while capability probing or FFmpeg startup is underway
  // waits for registration and then stops the newly started capture.
  const starting = this.pendingStarts.get(cameraId);
  if (starting) {
    try { await starting; } catch { return; } // Startup already cleaned up.
  }
  const managed = this.captures.get(cameraId);

  if (!managed) {
    return;
  }

  const stopPromise = (async () => {
    this.expectedStops.add(cameraId);
    try {
      if (managed.capture.supportsRecordingSwitch && managed.recordingEnabled) {
        // Finalize the disk output before turning off the camera source.
        try { await managed.capture.stopRecordingOutput(); }
        catch (error) { console.error("Recording could not finalize cleanly:", error); }
      }
      await managed.capture.stop();
    } finally {
      // Exit callback owns the normal removal and history event. If a
      // failed stop leaves the process alive, retain the capture so the
      // operator can retry rather than losing control of its handle.
      if (!managed.capture.isRunning) this.captures.delete(cameraId);
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
  this.shutdownInProgress = true;
  for (const cameraId of this.recoveryTimers.keys()) this.cancelRecovery(cameraId);
  this.recovery.clearAll();
  const cameraIds = [...new Set([...this.captures.keys(), ...this.pendingStarts.keys()])];

  try {
    await Promise.all(cameraIds.map((cameraId) => this.stop(cameraId)));
  } finally {
    this.shutdownInProgress = false;
  }
}

}
