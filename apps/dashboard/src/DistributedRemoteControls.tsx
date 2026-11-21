import { useEffect, useRef, useState } from "react";

type RequestNode = (url: string, options?: RequestInit) => Promise<any>;
type Action = { label: string; route: string; warning: string };
type Verification = { checkedAt: number; capture: string; youtube: string; warnings: string[]; complete: boolean; cameraId: string; observation: string };
type CameraSnapshot = { cameraId: string; running: boolean; tracked: boolean; relayState: string | null; checkedAt: number };
type Outcome = { action: string; cameraId: string; startedAt: number; phase: "awaiting-check" | "observed" | "check-failed"; detail: string; before: CameraSnapshot | null };

/** Require a complete reconciliation before deriving a comparable process snapshot. */
export function cameraSnapshot(capture: any, relay: any, cameraId: string, checkedAt: number): CameraSnapshot | null {
  if (!cameraId || !isCompleteReconciliation(capture, relay) || !Array.isArray(capture.running) || !Array.isArray(capture.tracked)) return null;
  if (!capture.running.every((id: any) => typeof id === "string") || !capture.tracked.every((id: any) => typeof id === "string")) return null;
  const entries = relay.relays.filter((item: any) => item?.cameraId === cameraId);
  if (entries.length > 1 || (entries.length === 1 && typeof entries[0].state !== "string")) return null;
  return { cameraId, running: capture.running.includes(cameraId), tracked: capture.tracked.includes(cameraId), relayState: entries.length ? entries[0].state : null, checkedAt };
}

/** Compare only snapshots for the same camera taken on opposite sides of a command. */
export function compareCameraSnapshots(before: CameraSnapshot | null, after: CameraSnapshot | null, commandStartedAt: number): string {
  if (!before || !after || before.cameraId !== after.cameraId || before.checkedAt >= commandStartedAt || after.checkedAt < commandStartedAt)
    return "A comparable pre-command and post-command observation is unavailable. No state transition can be established.";
  const changes: string[] = [];
  if (before.running !== after.running) changes.push(`capture process: ${before.running ? "running" : "not running"} to ${after.running ? "running" : "not running"}`);
  if (before.tracked !== after.tracked) changes.push(`capture lease: ${before.tracked ? "tracked" : "not tracked"} to ${after.tracked ? "tracked" : "not tracked"}`);
  if (before.relayState !== after.relayState) changes.push(`relay: ${before.relayState ?? "not tracked"} to ${after.relayState ?? "not tracked"}`);
  return changes.length ? `Observed changes: ${changes.join("; ")}. Changes do not prove the command caused them or that playback/recording is healthy.`
    : "No process, lease or relay-state transition observed. This does not establish command failure or success.";
}

/** A point-in-time process observation is not proof that the preceding command caused it. */
export function observeCameraState(capture: any, relay: any, cameraId: string): string {
  if (!cameraId) return "No individual camera selected. Bulk command outcomes require inspecting all affected cameras.";
  if (!Array.isArray(capture?.running) || !Array.isArray(capture?.tracked) || !Array.isArray(relay?.relays)) return "Camera process observations unavailable.";
  const running = capture.running.includes(cameraId);
  const tracked = capture.tracked.includes(cameraId);
  const entry = relay.relays.find((item: any) => item?.cameraId === cameraId);
  const relayState = entry && typeof entry.state === "string" ? entry.state : "not tracked";
  return `Camera ${cameraId}: capture process ${running ? "running" : "not running"}; capture lease ${tracked ? "tracked" : "not tracked"}; relay ${relayState}. This is a snapshot, not proof of command success or YouTube playback.`;
}


/** A reconciliation response is diagnostic, not confirmation that a live command succeeded. */
export function isCompleteReconciliation(capture: any, relay: any): boolean {
  return capture?.enabled === true && Array.isArray(capture.untrackedRunning) &&
    Array.isArray(capture.trackedNotRunning) && Array.isArray(capture.uncertainRings) &&
    relay?.enabled === true && Array.isArray(relay.relays) && Array.isArray(relay.uncertainRings);
}

/** Read-only checks cannot establish YouTube viewer health or prove a mutation succeeded. */
export function summarizeRemoteVerification(capture: any, relay: any, cameraId: string): Omit<Verification, "checkedAt" | "complete" | "cameraId" | "observation"> {
  const warnings: string[] = [];
  if (!capture || capture.enabled !== true || !Array.isArray(capture.untrackedRunning) || !Array.isArray(capture.trackedNotRunning) || !Array.isArray(capture.uncertainRings)) {
    warnings.push("Capture reconciliation unavailable or malformed");
  } else {
    for (const key of ["untrackedRunning", "trackedNotRunning", "uncertainRings"] as const) {
      if (capture[key].length) warnings.push(`${key}: ${capture[key].join(", ")}`);
    }
  }
  if (!relay || relay.enabled !== true || !Array.isArray(relay.relays) || !Array.isArray(relay.uncertainRings)) {
    warnings.push("YouTube reconciliation unavailable or malformed");
  } else {
    if (relay.uncertainRings.length) warnings.push(`Uncertain YouTube rings: ${relay.uncertainRings.join(", ")}`);
    if (relay.safe === false) warnings.push("YouTube reconciliation is not safe");
  }
  const selected = relay?.relays?.find((item: any) => item?.cameraId === cameraId);
  return { capture: capture?.safeToEnable === true ? "No capture reconciliation issues reported" : "Capture requires review",
    youtube: selected ? `Selected relay: ${String(selected.state ?? "unknown")}` : "Selected relay not tracked", warnings };
}

const bulkActions: Action[] = [
  { label: "Start distributed recordings", route: "/api/captures/distributed-start-all", warning: "Starts recording on this remote PC." },
  { label: "Stop distributed recordings", route: "/api/captures/distributed-stop-all", warning: "Stops recording on this remote PC. Verify all recordings first." },
  { label: "Start distributed YouTube relays", route: "/api/youtube/distributed-start-all", warning: "Starts YouTube relays on this remote PC." },
  { label: "Stop distributed YouTube relays", route: "/api/youtube/distributed-stop-all", warning: "Stops live YouTube relays on this remote PC." }
];

/** These commands are deliberately manual, single-flight and never automatically retried. */
export function DistributedRemoteControls({ nodeName, connected, enabled, requestNode, cameraIds = [] }: {
  nodeName: string; connected: boolean; enabled: boolean; requestNode: RequestNode; cameraIds?: string[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [baseline, setBaseline] = useState<CameraSnapshot | null>(null);
  const [comparison, setComparison] = useState<string | null>(null);
  const inFlight = useRef(false);
  const verificationInFlight = useRef(false);
  const lastOperation = useRef(0);
  const generation = useRef(0);
  const cameraSelectionVersion = useRef(0);
  const validCameraIds = [...new Set(cameraIds.filter(id => typeof id === "string" && id.length > 0))];
  const camera = validCameraIds.includes(selectedCamera) ? selectedCamera : validCameraIds[0] ?? "";
  useEffect(() => {
    generation.current += 1;
    cameraSelectionVersion.current += 1;
    setMessage(null);
    setUncertain(false);
    setPending(null);
    inFlight.current = false;
    verificationInFlight.current = false;
    lastOperation.current = 0;
    setSelectedCamera("");
    setVerification(null);
    setVerifying(false);
    setOutcome(null);
    setBaseline(null);
    setComparison(null);
  }, [nodeName]);
  async function verifyStatus() {
    if (!connected || verificationInFlight.current || inFlight.current) return;
    verificationInFlight.current = true;
    const currentGeneration = generation.current;
    const currentOperation = lastOperation.current;
    const checkedCamera = camera;
    const selectionVersion = cameraSelectionVersion.current;
    setVerifying(true);
    setVerification(null);
    try {
      const [capture, relay] = await Promise.all([
        requestNode("/api/captures/distributed-reconciliation"),
        requestNode("/api/youtube/distributed-reconciliation")
      ]);
      if (currentGeneration !== generation.current || currentOperation !== lastOperation.current || selectionVersion !== cameraSelectionVersion.current) return;
      const complete = isCompleteReconciliation(capture, relay);
      const checkedAt = Date.now();
      const snapshot = cameraSnapshot(capture, relay, checkedCamera, checkedAt);
      setVerification({ ...summarizeRemoteVerification(capture, relay, checkedCamera), checkedAt, cameraId: checkedCamera, observation: observeCameraState(capture, relay, checkedCamera), complete });
      if (!outcome && snapshot) setBaseline(snapshot);
      if (outcome?.phase === "awaiting-check") setComparison(compareCameraSnapshots(outcome.before, snapshot, outcome.startedAt));
      setOutcome(previous => previous?.phase === "awaiting-check" ? {
        ...previous,
        phase: complete ? "observed" : "check-failed",
        detail: complete
          ? "Reconciliation data received after the command. This does not prove the command took effect. Inspect actual recordings and YouTube playback."
          : "Reconciliation is incomplete. The command outcome remains unverified."
      } : previous);
    } catch (error) {
      if (currentGeneration !== generation.current || currentOperation !== lastOperation.current || selectionVersion !== cameraSelectionVersion.current) return;
      setVerification({ checkedAt: Date.now(), cameraId: checkedCamera, observation: "Camera process observations unavailable.", capture: "Unavailable", youtube: "Unavailable", warnings: [`Status check failed: ${String(error)}`], complete: false });
      setOutcome(previous => previous?.phase === "awaiting-check" ? { ...previous, phase: "check-failed", detail: "Status check failed. Command outcome remains unverified." } : previous);
    } finally { if (currentGeneration === generation.current) { verificationInFlight.current = false; setVerifying(false); } }
  }
  async function execute(action: Action) {
    if (!connected || !enabled || inFlight.current || verificationInFlight.current || pending || uncertain) return;
    if (!window.confirm(`${action.warning}\n\nTarget: ${nodeName}\n\nContinue?`)) return;
    inFlight.current = true;
    lastOperation.current += 1;
    const currentGeneration = generation.current;
    setPending(action.route);
    setMessage(null);
    setVerification(null);
    setOutcome(null);
    setComparison(null);
    const targetCamera = camera;
    const before = baseline?.cameraId === targetCamera ? baseline : null;
    const startedAt = Date.now();
    try {
      const result = await requestNode(action.route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.route === "/api/captures/distributed-stop-all" ? {recordingsOnly:true} : {}) });
      if (currentGeneration !== generation.current) return;
      if (!result || result.error || result.ok === false || result.success === false) {
        setUncertain(true);
        setMessage(`${action.label}: remote server did not confirm success${result?.error ? `: ${String(result.error)}` : ""}. Inspect remote status before another command.`);
        setOutcome({ action: action.label, cameraId: targetCamera, startedAt, phase: "awaiting-check", before, detail: "Server did not acknowledge the command. Actual outcome unknown." });
      } else {
        setMessage(`${action.label}: request acknowledged. Verify the actual recording or relay state on ${nodeName}.`);
        setOutcome({ action: action.label, cameraId: targetCamera, startedAt, phase: "awaiting-check", before, detail: "Command acknowledged, but no post-command status has been checked." });
      }
    } catch (error) {
      if (currentGeneration !== generation.current) return;
      setUncertain(true);
      setMessage(`Command result unknown: ${error instanceof Error ? error.message : String(error)}. Do not retry until you inspect the remote PC's capture and relay status.`);
      setOutcome({ action: action.label, cameraId: targetCamera, startedAt, phase: "awaiting-check", before, detail: "Network error. The command may have executed." });
    } finally {
      if (currentGeneration === generation.current) {
        inFlight.current = false;
        setPending(null);
      }
    }
  }
  const cameraActions: Action[] = camera ? [
    { label: "Recover selected recording", route: `/api/captures/${encodeURIComponent(camera)}/recover`, warning: `Attempts lease-aware recording recovery for camera ${camera}. Do not use while recording state is uncertain.` },
    { label: "Restart selected YouTube relay", route: `/api/youtube/${encodeURIComponent(camera)}/distributed-restart`, warning: `Restarts the distributed YouTube relay for camera ${camera}. This can interrupt its live stream.` }
  ] : [];
  return <details className="session-panel compact-collapsible" aria-label="Distributed remote operations">
    <summary>Distributed remote operations (experimental)</summary>
    <p className="muted">Requires TSM_REMOTE_DISTRIBUTED_CONTROL=1 on the primary server and distributed mode on the remote capture node. Commands affect {nodeName} only.</p>
    <div style={{display:"flex", flexWrap:"wrap", gap:"0.5rem"}}>
      {bulkActions.map(action => <button type="button" key={action.route} disabled={!connected || !enabled || !!pending || verifying || uncertain}
        onClick={() => void execute(action)}>{pending === action.route ? "Working..." : action.label}</button>)}
    </div>
    <div style={{marginTop:"0.75rem"}}>
      <label htmlFor="distributed-recovery-camera">Individual camera recovery</label>
      <select id="distributed-recovery-camera" value={camera} disabled={!connected || !enabled || !!pending || verifying || uncertain || !camera} onChange={e => { cameraSelectionVersion.current += 1; setSelectedCamera(e.target.value); setVerification(null); setBaseline(null); setComparison(null); }}>
        {validCameraIds.length === 0 && <option value="">No assigned cameras</option>}
        {validCameraIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
      <div style={{display:"flex", flexWrap:"wrap", gap:"0.5rem", marginTop:"0.5rem"}}>
        {cameraActions.map(action => <button type="button" key={action.route} disabled={!connected || !enabled || !!pending || verifying || uncertain}
          onClick={() => void execute(action)}>{pending === action.route ? "Working..." : action.label}</button>)}
      </div>
    </div>
    {message && <p role="status">{message}</p>}
    {outcome && <section aria-label="Last remote command outcome" style={{marginTop:"0.75rem"}}>
      <strong>Last command: {outcome.action}</strong>
      <p className="muted">Requested {new Date(outcome.startedAt).toLocaleTimeString()}. {outcome.detail}</p>
      {comparison && <p role="status">{comparison}</p>}
      {outcome.phase === "awaiting-check" && <p role="status">Awaiting post-command reconciliation. Use the status check below. Do not assume success.</p>}
      {outcome.phase === "observed" && <p role="status">Reconciliation checked. Actual recording and viewer-facing stream health still require independent confirmation.</p>}
      {outcome.phase === "check-failed" && <p role="alert">Outcome unverified. Inspect the remote PC before retrying.</p>}
    </section>}
    {uncertain && <p role="alert">The previous operation may have executed despite the reported error. Verify actual remote state before issuing another command.</p>}
    <div style={{marginTop:"0.75rem"}}>
      <button type="button" disabled={!connected || !!pending || verifying} onClick={() => void verifyStatus()}>{verifying ? "Checking..." : "Check remote reconciliation status"}</button>
      {baseline && !outcome && <p className="muted">Pre-command baseline captured for camera {baseline.cameraId} at {new Date(baseline.checkedAt).toLocaleTimeString()}. Recheck after a command to compare process state.</p>}
      {verification && <div role="status" aria-live="polite">
        <p>Checked {new Date(verification.checkedAt).toLocaleTimeString()}. {verification.capture}. {verification.youtube}.</p>
        <p>{verification.observation}</p>
        {verification.warnings.length > 0 ? <p role="alert">{verification.warnings.join("; ")}</p> : <p>No reconciliation warnings reported. Confirm actual video and recording output separately.</p>}
      </div>}
    </div>
    {uncertain && <button type="button" disabled={!connected || verifying || !!pending || (!verification?.complete || verification.cameraId !== camera)} onClick={() => { if (window.confirm(`Have you independently checked the actual recording and YouTube state on ${nodeName}? A reconciliation response alone does not prove stream health.`)) { setUncertain(false); setMessage(null); setVerification(null); } }}>I independently verified remote status</button>}
    {uncertain && !verification?.complete && <p className="muted">Run a successful reconciliation check before manually acknowledging an uncertain command. You must still inspect actual recordings and YouTube output.</p>}
  </details>;
}
