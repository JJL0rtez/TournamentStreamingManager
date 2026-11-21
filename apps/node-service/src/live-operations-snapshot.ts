/** A read-only local operations summary. Never represents local FFmpeg output as verified YouTube playback. */
export type Severity = "critical" | "warning" | "ok";
export interface AssignmentInput { cameraId: string; ring: string; cameraName?: string }
export interface CaptureInput { cameraId: string; running: boolean; recordingEnabled: boolean; outputMode: string; frameAgeMs: number | null; recordingPath?: string }
export interface RelayInput { cameraId: string; relayHealth: string; lastProgressAt: number | null }
export interface RetryInput { cameraId: string; pending: boolean; attempts: number; nextRetryAt?: string | null }
export interface OperationsRow {
  cameraId: string; ring: string; cameraName: string; severity: Severity;
  capture: "running" | "stopped" | "missing"; recording: "enabled" | "disabled" | "not-running";
  relay: "sending" | "connecting" | "stalled" | "error" | "inactive";
  captureMode: string | null; frameAgeMs: number | null; pendingRecovery: boolean;
  recoveryAttempts: number; nextRetryAt: string | null; issues: string[];
}
export function makeLiveOperationsSnapshot(input: {
  eventId?: string | null; eventName?: string | null; assignments: AssignmentInput[];
  captures: CaptureInput[]; relays: RelayInput[]; captureRetries: RetryInput[]; relayRetries: RetryInput[];
  now?: string;
}) {
  const captures = new Map(input.captures.map(item => [item.cameraId, item]));
  const relays = new Map(input.relays.map(item => [item.cameraId, item]));
  const captureRetries = new Map(input.captureRetries.map(item => [item.cameraId, item]));
  const relayRetries = new Map(input.relayRetries.map(item => [item.cameraId, item]));
  const rows: OperationsRow[] = input.assignments.map(assignment => {
    const capture = captures.get(assignment.cameraId);
    const relay = relays.get(assignment.cameraId);
    const captureRetry = captureRetries.get(assignment.cameraId);
    const relayRetry = relayRetries.get(assignment.cameraId);
    const issues: string[] = [];
    let severity: Severity = "ok";
    const critical = (message: string) => { issues.push(message); severity = "critical"; };
    const warning = (message: string) => { issues.push(message); if (severity !== "critical") severity = "warning"; };
    if (!capture) critical("Assigned capture is missing on this node");
    else if (!capture.running) critical("Assigned capture process is stopped");
    else {
      if (capture.frameAgeMs !== null && capture.frameAgeMs > 5000) critical("No recent captured video frames (over 5 seconds)");
      if (!capture.recordingEnabled && !relay) warning("Capture has no recording or relay output");
      if (capture.outputMode !== "production") warning("Capture is not in production mode");
    }
    if (relay?.relayHealth === "error" || relay?.relayHealth === "stalled") critical(`Local YouTube relay ${relay.relayHealth}`);
    else if (relay?.relayHealth === "connecting") warning("Local YouTube relay connecting; ingest not verified");
    if (captureRetry?.pending || relayRetry?.pending) warning("Automatic retry scheduled");
    const validRelay = relay?.relayHealth;
    return {
      cameraId: assignment.cameraId, ring: assignment.ring, cameraName: assignment.cameraName ?? assignment.cameraId,
      severity, capture: !capture ? "missing" : capture.running ? "running" : "stopped",
      recording: !capture?.running ? "not-running" : capture.recordingEnabled ? "enabled" : "disabled",
      relay: validRelay === "sending" || validRelay === "connecting" || validRelay === "stalled" || validRelay === "error" ? validRelay : "inactive",
      captureMode: capture?.outputMode ?? null, frameAgeMs: capture?.frameAgeMs ?? null,
      pendingRecovery: Boolean(captureRetry?.pending || relayRetry?.pending),
      recoveryAttempts: (captureRetry?.attempts ?? 0) + (relayRetry?.attempts ?? 0),
      nextRetryAt: captureRetry?.nextRetryAt ?? relayRetry?.nextRetryAt ?? null, issues
    } satisfies OperationsRow;
  });
  const known = new Set(input.assignments.map(item => item.cameraId));
  const unassignedActiveCaptures = input.captures.filter(item => item.running && !known.has(item.cameraId)).map(item => item.cameraId);
  const unassignedActiveRelays = input.relays.filter(item => !known.has(item.cameraId)).map(item => item.cameraId);
  return {
    checkedAt: input.now ?? new Date().toISOString(), scope: "local-node", eventId: input.eventId ?? null,
    eventName: input.eventName ?? null, configured: input.assignments.length > 0,
    counts: { assigned: rows.length, critical: rows.filter(r => r.severity === "critical").length,
      warning: rows.filter(r => r.severity === "warning").length, ok: rows.filter(r => r.severity === "ok").length },
    rows, unassignedActiveCaptures, unassignedActiveRelays,
    youtubeVerified: false,
    note: "This is a local process/recording readiness snapshot. Relay activity does not prove YouTube ingest or audience playback. Unstarted optional relays are informational, not failures."
  };
}
