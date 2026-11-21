/** Reject competing capture implementations for the same camera before spawning FFmpeg.
 * This is local process protection, not distributed lease ownership. */
export type CapturePath = "shared" | "legacy-recording";
export function competingCapturePath(requested: CapturePath, sharedRunning: boolean, legacyRunning: boolean): string | null {
  if (requested === "shared" && legacyRunning) return "LEGACY_RECORDING_ALREADY_ACTIVE";
  if (requested === "legacy-recording" && sharedRunning) return "SHARED_CAPTURE_ALREADY_ACTIVE";
  return null;
}
