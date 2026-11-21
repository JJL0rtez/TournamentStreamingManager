export type CaptureMode = "production" | "diagnostic";
export function validateCaptureModeChange(current: CaptureMode | null, requested: unknown, running: boolean): CaptureMode {
  if (requested !== undefined && requested !== "production" && requested !== "diagnostic")
    throw new Error("INVALID_OUTPUT_MODE");
  const next = requested ?? "production";
  if (running && current !== null && current !== next)
    throw new Error("CAPTURE_MODE_TRANSITION_REQUIRES_STOP");
  return next as CaptureMode;
}
export function canUseProductionRelay(mode: CaptureMode): boolean { return mode === "production"; }
