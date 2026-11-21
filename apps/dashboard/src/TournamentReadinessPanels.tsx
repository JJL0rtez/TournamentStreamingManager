import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Capture, type DeviceList, type EquipmentTestResult, type IncidentEntry, type SessionAssignment, type StorageHealth, type StressResult, type TournamentReadiness, type YouTubeStream, fileSize } from "./dashboard-shared";
import { type CameraReliabilitySummary } from "./CameraReliabilityPanels";
import { type SystemResourceSnapshot } from "./SystemResources";
import { type CameraAssetRecord, type CameraMaintenanceSchedule, type UsbBandwidthReport } from "./HardwareDiagnostics";

export type ReadinessCheck = { name: string; state: "pass" | "warning" | "blocker" | "unknown"; detail: string };

export type PreTournamentAction = {
  id: string; priority: "blocker" | "warning" | "unknown";
  source: "readiness" | "maintenance" | "incident";
  title: string; detail: string; nextStep: string;
};

export const preTournamentPriority = { blocker: 0, warning: 1, unknown: 2 } as const;

export function readOpenTournamentIncidents(nodeId: string, eventId: string): { entries: IncidentEntry[]; error: string | null } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`) || "[]");
    if (!Array.isArray(value)) return { entries: [], error: "Incident history has an invalid format." };
    return { entries: value.filter((entry): entry is IncidentEntry => !!entry && typeof entry === "object" &&
      typeof entry.id === "string" && typeof entry.timestamp === "string" &&
      !entry.resolvedAt), error: null };
  } catch (error) { return { entries: [], error: `Incident history unavailable: ${String(error)}` }; }
}

export function buildPreTournamentActions(checks: ReadinessCheck[], nodeId: string, eventId: string): PreTournamentAction[] {
  const actions: PreTournamentAction[] = checks.filter(check => check.state !== "pass").map(check => ({
    id: `check:${check.name}`, priority: check.state === "blocker" ? "blocker" : check.state === "warning" ? "warning" : "unknown",
    source: check.name === "Camera maintenance" ? "maintenance" : "readiness", title: check.name,
    detail: check.detail,
    nextStep: check.name === "Camera maintenance" ? "Review and complete due inspections in Camera equipment inventory, then refresh readiness." :
      check.name === "Tournament assignments" ? "Run Check Tournament Readiness for the current ring assignments." :
      check.name === "Recording storage" ? "Inspect free disk space and recording storage health." :
      check.name === "Camera and USB history" ? "Review camera reliability and USB diagnostics." :
      check.name === "Active recording" ? "Verify a local test recording and camera preview before the event." :
      check.name === "YouTube streaming" ? "Test a stream and confirm playback on a separate device." :
      "Inspect the reported diagnostic evidence and repeat the readiness check."
  }));
  const incidents = readOpenTournamentIncidents(nodeId, eventId);
  for (const incident of incidents.entries) actions.push({
    id: `incident:${incident.id}`, priority: incident.impact === "interrupted" ? "blocker" : "warning",
    source: "incident", title: `${incident.ring || "Unassigned ring"}: ${incident.category || "Open incident"}`,
    detail: `${incident.description || "No description"} (opened ${new Date(incident.timestamp).toLocaleString()})`,
    nextStep: "Investigate the issue and close the incident in the incident log after verifying recovery."
  });
  if (incidents.error) actions.push({ id: "incident:unavailable", priority: "unknown", source: "incident",
    title: "Incident history unavailable", detail: incidents.error, nextStep: "Inspect the incident log in this browser." });
  return actions.sort((a,b) => preTournamentPriority[a.priority] - preTournamentPriority[b.priority] || a.title.localeCompare(b.title));
}

export type ReadinessSnapshot = {
  id: string; nodeId: string; eventId: string; checkedAt: string; savedAt: string;
  checks: ReadinessCheck[]; actions: PreTournamentAction[]; limitations: string[];
};

export function readinessSnapshotKey(nodeId: string, eventId: string) {
  return `tournament-readiness-snapshots-v1:${nodeId}:${eventId || "unsaved"}`;
}

export function loadReadinessSnapshots(nodeId: string, eventId: string): ReadinessSnapshot[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(readinessSnapshotKey(nodeId, eventId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is ReadinessSnapshot => !!v && typeof v === "object" &&
      typeof v.id === "string" && typeof v.checkedAt === "string" &&
      v.nodeId === nodeId && v.eventId === eventId && Array.isArray(v.checks) && Array.isArray(v.actions))
      .slice(0, 30);
  } catch { return []; }
}

export function ReadinessSnapshotHistory({ nodeId, eventId, current }: {
  nodeId: string; eventId: string;
  current: { checkedAt: string; checks: ReadinessCheck[]; actions: PreTournamentAction[]; eventId: string; limitations: string[] } | null;
}) {
  const [history, setHistory] = useState<ReadinessSnapshot[]>(() => loadReadinessSnapshots(nodeId, eventId));
  const [baselineId, setBaselineId] = useState("");
  const [followupId, setFollowupId] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setHistory(loadReadinessSnapshots(nodeId, eventId));
    setBaselineId(""); setFollowupId(""); setMessage("");
  }, [nodeId, eventId]);
  function save() {
    if (!current || current.eventId !== eventId) return;
    const entry: ReadinessSnapshot = {
      ...current, nodeId, eventId, savedAt: new Date().toISOString(),
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      checks: current.checks.map(c => ({ ...c })), actions: current.actions.map(a => ({ ...a }))
    };
    const next = [entry, ...loadReadinessSnapshots(nodeId, eventId)].slice(0, 30);
    try {
      localStorage.setItem(readinessSnapshotKey(nodeId, eventId), JSON.stringify(next));
      setHistory(next); setMessage("Readiness snapshot saved in this browser.");
    } catch (cause) { setMessage(`Could not save snapshot: ${String(cause)}`); }
  }
  function exportHistory() {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), nodeId, eventId, snapshots: history }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `readiness-snapshots-${eventId || "unsaved"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
  const baseline = history.find(s => s.id === baselineId);
  const followup = history.find(s => s.id === followupId);
  const baselineActions = new Map((baseline?.actions || []).map(a => [a.id, a]));
  const followupActions = new Map((followup?.actions || []).map(a => [a.id, a]));
  const resolved = [...baselineActions.values()].filter(a => !followupActions.has(a.id));
  const newActions = [...followupActions.values()].filter(a => !baselineActions.has(a.id));
  const unchanged = [...followupActions.values()].filter(a => baselineActions.has(a.id));
  const counts = (s: ReadinessSnapshot) => ({
    blockers: s.actions.filter(a => a.priority === "blocker").length,
    warnings: s.actions.filter(a => a.priority === "warning").length,
    unknown: s.actions.filter(a => a.priority === "unknown").length
  });
  return <section aria-label="Pre-tournament readiness snapshot history">
    <h4>Readiness snapshots and comparison</h4>
    <p>Save an initial check and a final check to document changes before the event. Snapshots are stored only in this browser for the selected capture node and tournament.</p>
    <button type="button" onClick={save} disabled={!current || current.eventId !== eventId}>Save current readiness snapshot</button>{" "}
    <button type="button" onClick={exportHistory} disabled={!history.length}>Export snapshot history JSON</button>
    {message && <p role="status">{message}</p>}
    {history.length ? <>
      <p>{history.length} saved snapshot(s), newest first. Maximum 30 per node and event.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Saved</th><th>Checked</th><th>Blockers</th><th>Warnings</th><th>Unknown</th></tr></thead><tbody>
        {history.map(s => { const c = counts(s); return <tr key={s.id}><td>{new Date(s.savedAt).toLocaleString()}</td><td>{new Date(s.checkedAt).toLocaleString()}</td><td>{c.blockers}</td><td>{c.warnings}</td><td>{c.unknown}</td></tr>; })}
      </tbody></table></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label>Initial snapshot <select value={baselineId} onChange={e => setBaselineId(e.target.value)}><option value="">Select initial</option>{history.map(s => <option key={s.id} value={s.id}>{new Date(s.savedAt).toLocaleString()}</option>)}</select></label>
        <label>Final snapshot <select value={followupId} onChange={e => setFollowupId(e.target.value)}><option value="">Select final</option>{history.map(s => <option key={s.id} value={s.id}>{new Date(s.savedAt).toLocaleString()}</option>)}</select></label>
      </div>
      {baseline && followup && <>
        {new Date(baseline.checkedAt).getTime() > new Date(followup.checkedAt).getTime() && <p role="alert">The initial check is later than the final check. Check your selection.</p>}
        {baseline.id === followup.id && <p role="alert">Select two different snapshots to compare.</p>}
        {baseline.id !== followup.id && <>
          <p>Initial: {baseline.actions.length} action(s). Final: {followup.actions.length} action(s). {resolved.length} no longer reported, {newActions.length} newly reported, {unchanged.length} still reported.</p>
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Change</th><th>Priority</th><th>Issue</th></tr></thead><tbody>
            {resolved.map(a => <tr key={`resolved:${a.id}`}><td>No longer reported</td><td>{a.priority}</td><td>{a.title}</td></tr>)}
            {newActions.map(a => <tr key={`new:${a.id}`}><td>New</td><td>{a.priority}</td><td>{a.title}</td></tr>)}
            {unchanged.map(a => <tr key={`still:${a.id}`}><td>Still reported</td><td>{a.priority} → {followupActions.get(a.id)?.priority}</td><td>{a.title}</td></tr>)}
          </tbody></table></div>
          <small>An action disappearing from a later snapshot does not prove it was fixed. It may reflect changed assignments, historical data, or unavailable measurements. Operator sign-off and live tests remain separate.</small>
        </>}
      </>}
    </> : <p>No snapshots saved for this tournament on this node.</p>}
  </section>;
}

export type LaunchDecision = { version: 1; nodeId: string; eventId: string; checkedAt: string;
  assignmentFingerprint: string; ringSignedAt: string; operator: string;
  authorizedAt: string; warningsAcknowledged: boolean; decision: "GO" };

export function TournamentLaunchAuthorization({ nodeId, eventId, assignments, snapshot }: {
  nodeId: string; eventId: string; assignments: SessionAssignment[];
  snapshot: { checkedAt: string; checks: ReadinessCheck[]; actions: PreTournamentAction[]; eventId: string } | null;
}) {
  const key = `tournament-launch-authorization-v1:${nodeId}:${eventId}`;
  const fingerprint = JSON.stringify(assignments.map(a => [a.ring, a.cameraId, a.microphoneName]));
  const [operator, setOperator] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => { setOperator(""); setAcknowledge(false); setNotice(""); setRevision(v => v + 1); }, [nodeId, eventId]);
  let ring: RingSignoffDocument | null = null;
  let saved: LaunchDecision | null = null;
  let storageError = false;
  try {
    ring = JSON.parse(localStorage.getItem(`tournament-ring-signoff-v1:${nodeId}:${eventId || "no-event"}`) || "null") as RingSignoffDocument | null;
    saved = JSON.parse(localStorage.getItem(key) || "null") as LaunchDecision | null;
  } catch { storageError = true; }
  const ringSigned = !!ring && ring.schemaVersion === 1 && ring.nodeId === nodeId && ring.eventId === eventId &&
    ring.assignmentFingerprint === fingerprint && !!ring.signedAt && !!ring.operator?.trim() && assignments.length > 0 &&
    assignments.every((a, i) => ringSignoffChecks.every(c => ring?.rings?.[`${i}:${a.ring}:${a.cameraId}`]?.checked?.[c.id] === true));
  const blockers = snapshot?.actions.filter(a => a.priority === "blocker") || [];
  const warnings = snapshot?.actions.filter(a => a.priority === "warning") || [];
  const unknown = snapshot?.actions.filter(a => a.priority === "unknown") || [];
  const fresh = !!snapshot && snapshot.eventId === eventId && !Number.isNaN(Date.parse(snapshot.checkedAt)) &&
    Date.now() - Date.parse(snapshot.checkedAt) >= 0 && Date.now() - Date.parse(snapshot.checkedAt) <= 15 * 60 * 1000;
  const eligible = !storageError && !!eventId && eventId !== "unsaved" && fresh && ringSigned &&
    blockers.length === 0 && unknown.length === 0;
  const validSaved = !!saved && saved.version === 1 && saved.nodeId === nodeId && saved.eventId === eventId &&
    saved.checkedAt === snapshot?.checkedAt && saved.assignmentFingerprint === fingerprint &&
    saved.ringSignedAt === ring?.signedAt && eligible && saved.decision === "GO";
  function authorize() {
    if (!eligible || !operator.trim() || (warnings.length > 0 && !acknowledge) || !snapshot || !ring?.signedAt) return;
    const record: LaunchDecision = { version: 1, nodeId, eventId, checkedAt: snapshot.checkedAt,
      assignmentFingerprint: fingerprint, ringSignedAt: ring.signedAt, operator: operator.trim(),
      authorizedAt: new Date().toISOString(), warningsAcknowledged: warnings.length > 0 && acknowledge, decision: "GO" };
    try { localStorage.setItem(key, JSON.stringify(record)); setNotice("Launch authorization saved locally."); setRevision(v => v + 1); }
    catch (cause) { setNotice(`Could not save authorization: ${String(cause)}`); }
  }
  function exportDecision() {
    if (!snapshot) return;
    const payload = { exportedAt: new Date().toISOString(), nodeId, eventId, checkedAt: snapshot.checkedAt,
      decision: validSaved ? "GO" : "NO-GO", authorization: validSaved ? saved : null,
      checks: snapshot.checks, outstandingActions: snapshot.actions,
      ringSignoffValid: ringSigned, ringSignedAt: ringSigned ? ring?.signedAt : null,
      warningsAcknowledged: validSaved ? saved?.warningsAcknowledged : false,
      limitations: ["Operator acknowledgement only; does not start or stop streams.",
        "This decision is based on a point-in-time readiness snapshot and browser-local records."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `tournament-launch-${eventId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Final tournament launch authorization">
    <h4>Final tournament launch authorization</h4>
    <p><strong>{validSaved ? "GO: operator authorized" : "NO-GO: not authorized"}</strong></p>
    <p>Requires a readiness check from the last 15 minutes, no blockers or unknowns, and a signed checklist for every assigned ring.</p>
    <ul>
      <li>Readiness snapshot: {fresh ? "Current" : "Missing, stale, or for another event"}</li>
      <li>Blocking actions: {blockers.length}; unverified actions: {unknown.length}; warnings: {warnings.length}</li>
      <li>Per-ring checklist: {ringSigned ? `Signed by ${ring?.operator}` : "Not signed or assignments changed"}</li>
      <li>Operator authorization: {validSaved ? `${saved?.operator} at ${new Date(saved!.authorizedAt).toLocaleString()}` : "Pending"}</li>
    </ul>
    {warnings.length > 0 && <><p>Warnings requiring acknowledgement:</p><ul>
      {warnings.map(a => <li key={a.id}>{a.title}: {a.detail}</li>)}
    </ul><label><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />
      I reviewed these warnings and accept responsibility for the launch decision.</label></>}
    <p><label>Authorizing operator: <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Operator name" /></label></p>
    <button type="button" disabled={!eligible || !operator.trim() || (warnings.length > 0 && !acknowledge)} onClick={authorize}>Authorize tournament launch</button>{" "}
    <button type="button" disabled={!snapshot} onClick={exportDecision}>Export launch decision JSON</button>{" "}
    <button type="button" onClick={() => { setRevision(v => v + 1); setNotice("Rechecked browser-local ring sign-off and authorization."); }}>Recheck sign-offs</button>
    {notice && <p role="status">{notice}</p>}
    {storageError && <p role="alert">Browser storage unavailable; launch authorization cannot be verified.</p>}
    <small>Any refreshed readiness snapshot, changed assignment, or invalidated ring sign-off invalidates an earlier GO authorization. This is a manual advisory gate, not an automatic stream start or hardware interlock.</small>
  </section>;
}

export type TournamentProcedureRecord = { version: 1; nodeId: string; eventId: string; updatedAt: string;
  checks: Record<string, boolean>; notes: string; operator: string; observations: Array<{
    at: string; recording: number; streaming: number; frozen: number; expected: number;
    cameraStatus: Array<{ ring: string; cameraId: string; recording: boolean; streaming: string; frozen: boolean }>;
  }> };

export const tournamentProcedureSteps = [
  { id: "launch-authorized", stage: "Launch", text: "Confirm current GO authorization in the readiness panel and verify the event and ring assignments." },
  { id: "start-recordings", stage: "Launch", text: "Use Start All Recordings, then refresh live status. Investigate any missing or frozen recordings." },
  { id: "recording-check", stage: "Launch", text: "Verify each assigned ring is recording, confirm file growth and check a short local audio/video sample." },
  { id: "start-streams", stage: "Launch", text: "Use Start Assigned YouTube Streams after local recordings are stable." },
  { id: "external-playback", stage: "Launch", text: "Verify each ring on YouTube from a separate device, including audio and the correct ring feed." },
  { id: "monitor", stage: "During event", text: "Monitor recording health, frozen previews, disk space, and YouTube relays. Log incidents and recovery actions." },
  { id: "stop-streams", stage: "Shutdown", text: "When the event finishes, use Stop All YouTube Streams. Confirm relays have stopped." },
  { id: "stop-recordings", stage: "Shutdown", text: "Use Stop All Recordings after streams are stopped. Wait for recording processes to finish." },
  { id: "verify-files", stage: "Shutdown", text: "Check saved files and segments for every ring, inspect audio/video and copy backups before clearing equipment." },
  { id: "final-report", stage: "Shutdown", text: "Export incident, recording, and post-tournament technical reports and record any outstanding issues." }
] as const;

export function TournamentLaunchShutdownGuide({ nodeId, eventId, assignments, captures, streams, requestNode }: {
  nodeId: string; eventId: string; assignments: SessionAssignment[]; captures: Capture[];
  streams: YouTubeStream[]; requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const key = `tournament-launch-shutdown-v1:${nodeId}:${eventId}`;
  const [record, setRecord] = useState<TournamentProcedureRecord>(() => ({
    version: 1, nodeId, eventId, updatedAt: new Date().toISOString(), checks: {}, notes: "", operator: "", observations: []
  }));
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (parsed?.version === 1 && parsed.nodeId === nodeId && parsed.eventId === eventId &&
        parsed.checks && typeof parsed.checks === "object" && Array.isArray(parsed.observations)) {
        setRecord(parsed); setNotice(""); return;
      }
    } catch { /* Bad or unavailable browser storage: start an unsaved worksheet. */ }
    setRecord({ version: 1, nodeId, eventId, updatedAt: new Date().toISOString(), checks: {}, notes: "", operator: "", observations: [] });
    setNotice("");
  }, [key, nodeId, eventId]);
  function update(next: TournamentProcedureRecord) {
    const value = { ...next, updatedAt: new Date().toISOString() };
    setRecord(value);
    try { localStorage.setItem(key, JSON.stringify(value)); setNotice("Saved locally."); }
    catch { setNotice("Browser storage unavailable. Export the worksheet to preserve it."); }
  }
  async function sampleStatus() {
    setChecking(true); setNotice("");
    try {
      const [capturesResult, streamsResult] = await Promise.all([
        requestNode("/api/captures") as Promise<{ captures: Capture[] }>,
        requestNode("/api/youtube/streams") as Promise<{ streams: YouTubeStream[] }>
      ]);
      const cameraStatus = assignments.map(a => {
        const capture = capturesResult.captures.find(c => c.cameraId === a.cameraId);
        const stream = streamsResult.streams.find(st => st.cameraId === a.cameraId);
        return { ring: a.ring, cameraId: a.cameraId, recording: !!capture?.running,
          streaming: stream?.status ?? "not active", frozen: !!capture?.previewFrozen };
      });
      const observation = { at: new Date().toISOString(), expected: assignments.length,
        recording: cameraStatus.filter(c => c.recording).length,
        streaming: cameraStatus.filter(c => c.streaming === "live").length,
        frozen: cameraStatus.filter(c => c.frozen).length, cameraStatus };
      update({ ...record, observations: [...record.observations, observation].slice(-40) });
      setNotice("Live status sampled. Confirm actual YouTube playback and saved files separately.");
    } catch (e) { setNotice(`Could not refresh live status: ${String(e)}`); }
    finally { setChecking(false); }
  }
  function exportWorksheet() {
    const payload = { ...record, exportedAt: new Date().toISOString(),
      limitations: ["Operator-reported checklist, not an automated launch gate.",
        "Live samples are point-in-time API readings, not proof of YouTube playback or valid recorded files."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `tournament-procedure-${eventId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const latest = record.observations[record.observations.length - 1];
  const completed = tournamentProcedureSteps.filter(step => record.checks[step.id]).length;
  return <section aria-label="Tournament launch and shutdown guide">
    <h4>Guided tournament launch and shutdown</h4>
    <p>Operator checklist for this capture node. Use the recording and YouTube controls above to perform each action. No automatic starts or stops.</p>
    <p><strong>{completed} / {tournamentProcedureSteps.length} steps confirmed</strong> for {eventId}.</p>
    <label>Operator <input value={record.operator} onChange={e => update({ ...record, operator: e.target.value })} placeholder="Operator name" /></label>
    {(["Launch", "During event", "Shutdown"] as const).map(stage => <div key={stage}>
      <h5>{stage}</h5>
      {tournamentProcedureSteps.filter(step => step.stage === stage).map(step =>
        <label key={step.id} style={{ display: "block", marginBottom: 8 }}>
          <input type="checkbox" checked={!!record.checks[step.id]}
            onChange={e => update({ ...record, checks: { ...record.checks, [step.id]: e.target.checked } })} /> {step.text}
        </label>)}
    </div>)}
    <div className="camera-actions">
      <button type="button" disabled={checking || !assignments.length} onClick={() => void sampleStatus()}>
        {checking ? "Checking..." : "Capture live recording/stream status"}</button>
      <button type="button" onClick={exportWorksheet}>Export procedure JSON</button>
      <button type="button" onClick={() => {
        if (!window.confirm("Reset this tournament procedure checklist and its saved observations?")) return;
        update({ version: 1, nodeId, eventId, updatedAt: new Date().toISOString(), checks: {}, notes: "", operator: "", observations: [] });
      }}>Reset worksheet</button>
    </div>
    {latest && <div className="bulk-results">
      <strong>Latest live status: {new Date(latest.at).toLocaleString()}</strong>
      <p>{latest.recording}/{latest.expected} recording; {latest.streaming}/{latest.expected} YouTube relays reporting live; {latest.frozen} frozen previews.</p>
      <ul>{latest.cameraStatus.map(c => <li key={c.cameraId}>{c.ring}: {c.recording ? "recording" : "not recording"}, stream {c.streaming}{c.frozen ? ", preview frozen" : ""}</li>)}</ul>
    </div>}
    <label>Operator notes <textarea value={record.notes} onChange={e => update({ ...record, notes: e.target.value })}
      placeholder="Record stream verification, backup locations, and shutdown issues" rows={3} /></label>
    {notice && <p role="status">{notice}</p>}
    <small>Checklists and observations are browser-local. A sampled relay status does not confirm viewers can watch YouTube. This guide does not enforce the GO authorization or safely stop active recordings by itself.</small>
  </section>;
}

export function TournamentReadinessOverview({ requestNode, readiness, readinessCurrent, captures, streamCount, nodeId, eventId, assignments }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
  readiness: TournamentReadiness | null; readinessCurrent: boolean;
  captures: Capture[]; streamCount: number; nodeId: string; eventId: string; assignments: SessionAssignment[];
}) {
  const [snapshot, setSnapshot] = useState<{ checkedAt: string; checks: ReadinessCheck[]; actions: PreTournamentAction[]; eventId: string; limitations: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    const [storage, reliability, resources] = await Promise.allSettled([
      requestNode("/api/storage/health") as Promise<StorageHealth>,
      requestNode("/api/camera-health/reliability-summary") as Promise<CameraReliabilitySummary>,
      requestNode("/api/system/resources") as Promise<SystemResourceSnapshot>
    ]);
    const checks: ReadinessCheck[] = [];
    const add = (name: string, state: ReadinessCheck["state"], detail: string) => checks.push({ name, state, detail });
    if (!readiness || !readinessCurrent) add("Tournament assignments", "unknown", "Run Check Tournament Readiness for the current assignments.");
    else add("Tournament assignments", readiness.blockers.length ? "blocker" : readiness.warnings.length ? "warning" : "pass",
      `${readiness.rings.length} ring(s); ${readiness.blockers.length} blocker(s), ${readiness.warnings.length} warning(s).`);
    if (storage.status === "fulfilled") add("Recording storage", storage.value.status === "critical" ? "blocker" : storage.value.status === "healthy" ? "pass" : "warning",
      `${fileSize(storage.value.freeBytes)} free; ${storage.value.status}.`);
    else add("Recording storage", "unknown", "Storage health unavailable: " + String(storage.reason));
    if (reliability.status === "fulfilled") add("Camera and USB history", reliability.value.totals.failedRecordings || reliability.value.totals.usbDisconnects ? "warning" : reliability.value.totals.recordings ? "pass" : "unknown",
      `${reliability.value.totals.failedRecordings} failed recording(s), ${reliability.value.totals.usbDisconnects} observed USB disconnect(s) in retained history.`);
    else add("Camera and USB history", "unknown", "Reliability history unavailable: " + String(reliability.reason));
    // Browser-local equipment schedules are operator records, not live device checks.
    // Read at refresh time so completed inspections are reflected without reloading.
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(`tournament-camera-assets-v1:${nodeId}`) || "[]");
      if (!Array.isArray(raw) || !raw.every(a => a && typeof a.label === "string" && Array.isArray(a.maintenance))) {
        add("Camera maintenance", "unknown", "Equipment inventory data is invalid; inspect or restore the inventory.");
      } else {
        const assets = raw as CameraAssetRecord[];
        const today = new Date().toISOString().slice(0, 10);
        const schedules = assets.flatMap(a => (Array.isArray(a.schedules) ? a.schedules : []).map(task => ({ camera: a.label, task })));
        const valid = schedules.filter(({ task }) => typeof task.nextDue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.nextDue));
        const overdue = valid.filter(({ task }) => task.nextDue < today);
        const due = valid.filter(({ task }) => task.nextDue === today);
        if (!assets.length || !schedules.length || valid.length !== schedules.length) {
          add("Camera maintenance", "unknown", `${assets.length} registered camera(s), ${valid.length} valid scheduled inspection(s). ${!assets.length ? "Register equipment and maintenance schedules." : !schedules.length ? "No maintenance schedules configured." : "Some schedules have invalid due dates."}`);
        } else if (overdue.length || due.length) {
          const affected = [...overdue, ...due].slice(0, 6).map(({ camera, task }) => `${camera}: ${task.task} (${task.nextDue})`).join("; ");
          add("Camera maintenance", "warning", `${overdue.length} overdue and ${due.length} due today. ${affected}${overdue.length + due.length > 6 ? "; additional tasks omitted" : ""}. Complete inspections in Camera equipment inventory.`);
        } else {
          add("Camera maintenance", "pass", `${valid.length} scheduled inspection(s) across ${assets.length} registered camera(s); none due or overdue. Does not verify unregistered cameras.`);
        }
      }
    } catch {
      add("Camera maintenance", "unknown", "Cannot read browser-local equipment maintenance schedules.");
    }
    const running = captures.filter(c => c.running && c.recordingEnabled !== false);
    add("Active recording", running.length && running.some(c => c.previewFrozen || (c.frameAgeMs !== null && c.frameAgeMs > 10000)) ? "warning" : running.length ? "pass" : "unknown",
      `${running.length} camera(s) recording; ${running.filter(c => c.previewFrozen).length} frozen preview(s). No active recording is not a failure before the event.`);
    add("YouTube streaming", streamCount ? "pass" : "unknown", `${streamCount} active relay(s). An active relay does not verify YouTube ingest or public playback.`);
    if (resources.status === "fulfilled") {
      const r = resources.value;
      const cpu = r.cpu.utilizationPercent;
      const gpu = r.gpu?.utilizationPercent;
      add("System resources", cpu !== null && cpu >= 90 || gpu !== null && gpu !== undefined && gpu >= 95 ? "warning" : cpu === null && (gpu === null || gpu === undefined) ? "unknown" : "pass",
        `CPU ${cpu === null ? "unavailable" : cpu.toFixed(0) + "%"}; GPU ${gpu === null || gpu === undefined ? "unavailable" : gpu.toFixed(0) + "%"}.`);
    } else add("System resources", "unknown", "Resource measurements unavailable: " + String(resources.reason));
    setSnapshot({ checkedAt: new Date().toISOString(), checks, actions: buildPreTournamentActions(checks, nodeId, eventId), eventId, limitations: [
      "This is a point-in-time diagnostic summary, not a live end-to-end streaming test.",
      "Historical failures may predate repairs; an empty history does not prove reliability.",
      "Readiness assignments and live capture/relay counts are captured from the dashboard at check time."
    ] });
    setBusy(false);
  }
  function exportJson() {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `tournament-readiness-overview-${snapshot.checkedAt.slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }
  return <section className="overview" aria-label="Consolidated tournament readiness dashboard">
    <h3>Consolidated tournament readiness</h3>
    <p>One place to review assignments, recording, storage, streaming, USB history, and system resources before the event.</p>
    <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Checking…" : "Refresh consolidated readiness"}</button>{" "}
    <button type="button" onClick={exportJson} disabled={!snapshot}>Export JSON</button>
    {error && <p role="alert">{error}</p>}
    {snapshot && snapshot.eventId !== eventId && <p role="alert">The selected tournament changed. Refresh readiness and the action list for this event.</p>}
    {snapshot && <>
      <p>Checked {new Date(snapshot.checkedAt).toLocaleString()}. {snapshot.checks.filter(c => c.state === "blocker").length} blocker(s), {snapshot.checks.filter(c => c.state === "warning").length} warning(s), {snapshot.checks.filter(c => c.state === "unknown").length} unverified.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Area</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
        {snapshot.checks.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.state.toUpperCase()}</td><td>{c.detail}</td></tr>)}
      </tbody></table></div>
      <h4>Prioritized pre-tournament action list</h4>
      <p>{snapshot.actions.length} action(s): {snapshot.actions.filter(a => a.priority === "blocker").length} blocker(s), {snapshot.actions.filter(a => a.priority === "warning").length} warning(s), {snapshot.actions.filter(a => a.priority === "unknown").length} unknown(s).</p>
      {snapshot.actions.length === 0 ? <p>No outstanding actions identified in the available checks. Complete the end-to-end streaming test separately.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Priority</th><th>Source</th><th>Issue</th><th>Recommended next step</th></tr></thead><tbody>
          {snapshot.actions.map(action => <tr key={action.id}><td>{action.priority.toUpperCase()}</td><td>{action.source}</td>
            <td><strong>{action.title}</strong><p>{action.detail}</p></td><td>{action.nextStep}</td></tr>)}
        </tbody></table></div>}
      <p className="muted">This list is a snapshot of browser-local incidents and maintenance records plus node readiness measurements. Refresh after making changes. It does not automatically clear incidents or complete maintenance tasks.</p>
      <small>{snapshot.limitations.join(" ")}</small>
    </>}
    <ReadinessSnapshotHistory nodeId={nodeId} eventId={eventId} current={snapshot} />
  </section>;
}

export interface HardwareReportSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  nodeId: string;
  eventName: string;
  eventId: string | null;
  readiness: TournamentReadiness | null;
  readinessIsCurrent: boolean;
  devices: DeviceList | null;
  usb: UsbBandwidthReport | null;
  resources: SystemResourceSnapshot | null;
  latestStress: { label: string; startedAt: string; endedAt: string;
    cameraResults: StressResult[] } | null;
  equipmentTests: Record<string, EquipmentTestResult>;
  assignments: SessionAssignment[];
  missingChecks: string[];
}

export type RingSignoffCheck = "position" | "audio" | "recording" | "playback" | "backup";

export const ringSignoffChecks: Array<{ id: RingSignoffCheck; label: string }> = [
  { id: "position", label: "Camera position, focus, framing and ring identification checked" },
  { id: "audio", label: "Correct microphone selected; speech and ambient audio listened to" },
  { id: "recording", label: "Local recording reviewed for resolution, frame rate and audio" },
  { id: "playback", label: "YouTube destination verified by watching and listening on another device" },
  { id: "backup", label: "Recovery steps, spare cable and local recording fallback reviewed" }
];

export type RingSignoffEntry = { checked: Partial<Record<RingSignoffCheck, boolean>>; notes: string };

export type RingSignoffDocument = {
  schemaVersion: 1; eventId: string | null; eventName: string; nodeId: string;
  assignmentFingerprint: string; updatedAt: string; operator: string;
  signedAt: string | null; rings: Record<string, RingSignoffEntry>;
};

export function RingPreTournamentSignoff({ nodeId, eventId, eventName, assignments }: {
  nodeId: string; eventId: string | null; eventName: string; assignments: SessionAssignment[];
}) {
  const fingerprint = JSON.stringify(assignments.map(a => [a.ring, a.cameraId, a.microphoneName]));
  const storageKey = `tournament-ring-signoff-v1:${nodeId}:${eventId || "no-event"}`;
  const makeEmpty = (): RingSignoffDocument => ({ schemaVersion: 1, eventId, eventName, nodeId,
    assignmentFingerprint: fingerprint, updatedAt: new Date().toISOString(), operator: "", signedAt: null, rings: {} });
  const [document, setDocument] = useState<RingSignoffDocument>(makeEmpty);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.schemaVersion === 1 && saved?.rings && typeof saved.rings === "object") {
        setDocument(saved as RingSignoffDocument); setStorageWarning(""); return;
      }
    } catch { setStorageWarning("Browser storage could not be read. Export the checklist to retain it."); }
    setDocument(makeEmpty());
  }, [storageKey]);
  const stale = document.assignmentFingerprint !== fingerprint;
  const ringKey = (assignment: SessionAssignment, index: number) => `${index}:${assignment.ring}:${assignment.cameraId}`;
  const allComplete = assignments.length > 0 && !stale && assignments.every((assignment, index) =>
    ringSignoffChecks.every(check => document.rings[ringKey(assignment, index)]?.checked?.[check.id] === true));
  function update(next: RingSignoffDocument) {
    const revised = { ...next, signedAt: null, updatedAt: new Date().toISOString() };
    setDocument(revised);
    try { localStorage.setItem(storageKey, JSON.stringify(revised)); setStorageWarning(""); }
    catch { setStorageWarning("Browser storage is unavailable. Export this checklist before leaving."); }
  }
  function updateRing(key: string, patch: Partial<RingSignoffEntry>) {
    const current = document.rings[key] || { checked: {}, notes: "" };
    update({ ...document, rings: { ...document.rings, [key]: { ...current, ...patch } } });
  }
  function download() {
    const payload = { ...document, exportAt: new Date().toISOString(),
      assignmentFingerprintCurrent: fingerprint, assignmentChanged: stale,
      allChecksComplete: allComplete, signoffValid: Boolean(document.signedAt && allComplete) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = window.document.createElement("a"); a.href = url;
    a.download = `tournament-ring-signoff-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    window.document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="overview" aria-label="Per-ring pre-tournament operator sign-off">
    <h2>Per-ring Pre-tournament Checklist</h2>
    <p>Manually verify positioning, microphone audio, local recording quality, YouTube playback and
      recovery procedures for every assigned ring. Ticking a box does not perform a test.</p>
    {stale && <p role="alert">Assignments have changed since this checklist was saved. Reset the
      checklist before signing off. Export the old checklist first if needed.</p>}
    {storageWarning && <p role="alert">{storageWarning}</p>}
    {assignments.length === 0 && <p>No rings assigned. Assign cameras before completing the checklist.</p>}
    {assignments.map((assignment, index) => {
      const key = ringKey(assignment, index);
      const entry = document.rings[key] || { checked: {}, notes: "" };
      const count = ringSignoffChecks.filter(c => entry.checked[c.id]).length;
      return <div className="bulk-results" key={key}>
        <h3>{assignment.ring || `Ring ${index + 1}`} ({count}/{ringSignoffChecks.length})</h3>
        <p>Camera: {assignment.cameraName} | Microphone: {assignment.microphoneName}</p>
        {ringSignoffChecks.map(check => <label key={check.id} style={{ display: "block", margin: "0.4rem 0" }}>
          <input type="checkbox" disabled={stale} checked={entry.checked[check.id] === true}
            onChange={e => updateRing(key, { checked: { ...entry.checked, [check.id]: e.target.checked } })} /> {check.label}
        </label>)}
        <label>Test observations / exceptions: <textarea disabled={stale} value={entry.notes}
          onChange={e => updateRing(key, { notes: e.target.value })} rows={2} /></label>
      </div>;
    })}
    <p><strong>Progress:</strong> {assignments.filter((a, i) => ringSignoffChecks.every(c =>
      document.rings[ringKey(a, i)]?.checked?.[c.id])).length} of {assignments.length} rings complete.</p>
    <label>Operator name: <input type="text" disabled={stale} value={document.operator}
      onChange={e => update({ ...document, operator: e.target.value })} /></label>
    <button type="button" disabled={!allComplete || !document.operator.trim() || Boolean(document.signedAt)}
      onClick={() => {
        const signed = { ...document, signedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        setDocument(signed);
        try { localStorage.setItem(storageKey, JSON.stringify(signed)); }
        catch { setStorageWarning("Sign-off is not persisted. Export the report now."); }
      }}>Sign off all rings</button>
    {document.signedAt && <p role="status">{stale ? "STALE SIGN-OFF" : "Signed"} by {document.operator} at
      {" "}{new Date(document.signedAt).toLocaleString()}. Changes invalidate sign-off.</p>}
    <button type="button" onClick={download}>Export Ring Checklist JSON</button>
    <button type="button" onClick={() => {
      if (window.confirm("Clear all per-ring checks and sign-off for this event?")) update(makeEmpty());
    }}>Reset Ring Checklist</button>
    <p>Saved in this browser for this node and event, not synchronized to other dashboards.
      Export the signed checklist for tournament records. Sign-off is an operator acknowledgement,
      not independent proof that streaming or recording works.</p>
  </section>;
}

export function TournamentHardwareReport({ requestNode, nodeId, eventName, eventId, assignments,
  readiness, readinessCurrent, latestStress, equipmentTests }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
  nodeId: string; eventName: string; eventId: string | null;
  assignments: SessionAssignment[]; readiness: TournamentReadiness | null;
  readinessCurrent: boolean;
  latestStress: { label: string; report: { startedAt: string; endedAt: string;
    cameraResults: StressResult[] } } | null;
  equipmentTests: Record<string, EquipmentTestResult>;
}) {
  const [report, setReport] = useState<HardwareReportSnapshot | null>(null);
  const checklistItems = [
    { id: "cameras", label: "All assigned cameras are connected and correctly labelled" },
    { id: "microphones", label: "Each ring microphone was checked for correct audio" },
    { id: "recording", label: "Recording destinations and available disk space verified" },
    { id: "usb", label: "USB port arrangement confirmed and tested under full load" },
    { id: "stress", label: "Full multi-camera stress test completed for current setup" },
    { id: "youtube", label: "YouTube destinations and live connectivity verified separately" },
    { id: "backup", label: "Recovery procedure, backup files and spare equipment checked" },
    { id: "operators", label: "Ring assignments and operator responsibilities confirmed" }
  ];
  const checklistKey = `tournament-preflight-v1:${nodeId}:${eventId || "no-event"}`;
  type PreflightState = { checked: Record<string, boolean>; operator: string; signedAt: string | null };
  function loadPreflight(): PreflightState {
    try {
      const saved = JSON.parse(localStorage.getItem(checklistKey) || "null");
      if (saved && typeof saved === "object") return {
        checked: typeof saved.checked === "object" && saved.checked !== null ? saved.checked : {},
        operator: typeof saved.operator === "string" ? saved.operator : "",
        signedAt: typeof saved.signedAt === "string" ? saved.signedAt : null
      };
    } catch { /* storage unavailable or invalid */ }
    return { checked: {}, operator: "", signedAt: null };
  }
  const [preflight, setPreflight] = useState<PreflightState>(loadPreflight);
  useEffect(() => { setPreflight(loadPreflight()); }, [checklistKey]);
  function updatePreflight(change: Partial<PreflightState>) {
    setPreflight(previous => {
      const next = { ...previous, ...change, signedAt: null };
      try { localStorage.setItem(checklistKey, JSON.stringify(next)); } catch { /* memory only */ }
      return next;
    });
  }
  const allSignedChecks = checklistItems.every(item => preflight.checked[item.id] === true);
  const reportBlockers = !!report && (report.missingChecks.length > 0 ||
    (report.readiness?.blockers.length || 0) > 0 || (report.readiness?.warnings.length || 0) > 0 ||
    (report.latestStress?.cameraResults.some(r => r.status !== "pass") ?? true) ||
    !report.readinessIsCurrent ||
    (report.latestStress ? (Date.now() - new Date(report.latestStress.endedAt).getTime()) > 86400000 ||
      new Date(report.latestStress.endedAt).getTime() > Date.now() : true));
  function signOff() {
    if (!report || reportBlockers || !allSignedChecks || !preflight.operator.trim()) return;
    const next = { ...preflight, signedAt: new Date().toISOString() };
    setPreflight(next);
    try { localStorage.setItem(checklistKey, JSON.stringify(next)); } catch { /* memory only */ }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true); setError(""); setReport(null);
    updatePreflight({}); // A new report requires a new operator sign-off.
    const missingChecks: string[] = [];
    async function optional<T>(url: string, name: string): Promise<T | null> {
      try { return await requestNode(url) as T; }
      catch (cause) { missingChecks.push(`${name}: ${String(cause)}`); return null; }
    }
    try {
      const [devices, usb, resources] = await Promise.all([
        optional<DeviceList>("/api/devices", "Camera inventory"),
        optional<UsbBandwidthReport>("/api/usb/bandwidth-estimate", "USB estimates"),
        optional<SystemResourceSnapshot>("/api/system/resources", "System resources")
      ]);
      if (!readiness || !readinessCurrent) missingChecks.push("Tournament readiness not checked for current assignments");
      if (!latestStress) missingChecks.push("No saved 30-second stress test in this browser");
      if (assignments.some(a => !equipmentTests[a.cameraId]))
        missingChecks.push("Some assigned cameras have no equipment test in this dashboard session");
      const value: HardwareReportSnapshot = {
        schemaVersion: 1, generatedAt: new Date().toISOString(), nodeId,
        eventName, eventId, assignments: assignments.map(a => ({ ...a })),
        readiness: readinessCurrent ? readiness : null, readinessIsCurrent: !!readiness && readinessCurrent,
        devices, usb, resources,
        latestStress: latestStress ? { label: latestStress.label,
          startedAt: latestStress.report.startedAt, endedAt: latestStress.report.endedAt,
          cameraResults: latestStress.report.cameraResults } : null,
        equipmentTests: { ...equipmentTests }, missingChecks
      };
      setReport(value);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify({ ...report, operatorChecklist: {
      items: checklistItems.map(item => ({ ...item, checked: preflight.checked[item.id] === true })),
      operator: preflight.operator.trim(), signedAt: preflight.signedAt,
      signOffValid: !!preflight.signedAt && !reportBlockers && allSignedChecks
    } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `tournament-hardware-readiness-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const failures = report?.latestStress?.cameraResults.filter(r => r.status === "failed").length || 0;
  const warnings = report?.latestStress?.cameraResults.filter(r => r.status === "warning").length || 0;
  const ageHours = report?.latestStress ?
    (new Date(report.generatedAt).getTime() - new Date(report.latestStress.endedAt).getTime()) / 3600000 : null;
  return <section className="overview" aria-label="Tournament hardware readiness report">
    <h2>Pre-event Hardware Readiness Report</h2>
    <p>Combines the most recent tournament readiness check, live device inventory,
      configured USB traffic estimates, a system resource snapshot, and the latest saved
      stress test. This is a planning report, not a guarantee of event reliability.</p>
    <button type="button" disabled={busy} onClick={() => void generate()}>
      {busy ? "Collecting hardware report..." : "Generate Hardware Readiness Report"}
    </button>
    {error && <p role="alert">Report generation failed: {error}</p>}
    {report && <div className="bulk-results" role="status">
      <p><strong>{report.readiness?.blockers.length ? "READINESS BLOCKERS" :
        report.missingChecks.length || failures || warnings || report.readiness?.warnings.length ?
        "REVIEW REQUIRED" : "CHECKS COLLECTED"}</strong></p>
      <p>Event: {report.eventName || "Unnamed"} | Generated: {new Date(report.generatedAt).toLocaleString()}</p>
      <p>Assigned rings: {report.assignments.length}; detected cameras: {report.devices?.cameras.length ?? "unavailable"};
        detected microphones: {report.devices?.microphones.length ?? "unavailable"}.</p>
      <p>Recording storage: {report.readiness?.storage ?
        `${fileSize(report.readiness.storage.freeBytes)} free (${report.readiness.storage.status})` : "not checked"}.</p>
      <p>USB estimated MJPEG input: {report.usb ?
        `${report.usb.totals.mjpegLowMbps}–${report.usb.totals.mjpegHighMbps} Mbps across ${report.usb.cameras.length} cameras` :
        "unavailable"}. These are estimates, not measured controller utilization.</p>
      <p>System snapshot: CPU {report.resources?.cpu.utilizationPercent ?? "n/a"}% | GPU
        {" "}{report.resources?.gpu?.utilizationPercent ?? "n/a"}% | RAM
        {" "}{report.resources ? fileSize(report.resources.memory.usedBytes) : "n/a"}.</p>
      <p>Latest saved stress test: {report.latestStress ?
        `${report.latestStress.label} (${report.latestStress.cameraResults.length} cameras, ${failures} failed, ${warnings} warnings)` :
        "not available"}.</p>
      {ageHours !== null && (ageHours < 0 || ageHours > 24) &&
        <p role="alert">Stress-test results are {ageHours < 0 ? "dated in the future" :
          `over ${Math.floor(ageHours)} hours old`}. Re-test the current hardware arrangement.</p>}
      {report.readiness?.blockers.map((message, index) => <p key={`b${index}`}>BLOCKER: {message}</p>)}
      {report.readiness?.warnings.map((message, index) => <p key={`w${index}`}>WARNING: {message}</p>)}
      {report.missingChecks.map((message, index) => <p key={`m${index}`}>NOT VERIFIED: {message}</p>)}
      <table><thead><tr><th>Ring</th><th>Camera</th><th>Mic</th><th>Video/audio test</th><th>Stress test</th></tr></thead>
        <tbody>{report.assignments.map((assignment, index) => {
          const device = report.devices?.cameras.some(d => d.id === assignment.cameraId);
          const mic = report.devices?.microphones.some(d => d.name === assignment.microphoneName);
          const test = report.equipmentTests[assignment.cameraId];
          const stress = report.latestStress?.cameraResults.find(r => r.cameraId === assignment.cameraId);
          return <tr key={`${assignment.cameraId}-${index}`}><td>{assignment.ring}</td>
            <td>{assignment.cameraName}: {device === undefined ? "unknown" : device ? "connected" : "MISSING"}</td>
            <td>{assignment.microphoneName}: {mic === undefined ? "unknown" : mic ? "connected" : "MISSING"}</td>
            <td>{test ? `${test.video.status} / ${test.audio.status}` : "not tested"}</td>
            <td>{stress?.status || "not tested"}</td></tr>;
        })}</tbody></table>
      <p>Saved stress results may refer to a different USB arrangement or recording configuration.
        Refresh tournament readiness and repeat the stress test immediately before the event.
        YouTube connectivity is not verified by this report.</p>
      <h3>Tournament-day operator checklist</h3>
      <p>Manually confirm each step. Checking a box does not perform the check automatically.
        Checklist entries are stored in this browser for the current event and node.</p>
      {checklistItems.map(item => <label key={item.id} style={{ display: "block", margin: "0.5rem 0" }}>
        <input type="checkbox" checked={preflight.checked[item.id] === true}
          onChange={event => updatePreflight({ checked: { ...preflight.checked, [item.id]: event.target.checked } })} />
        {" "}{item.label}
      </label>)}
      <label>Operator name: <input type="text" value={preflight.operator}
        onChange={event => updatePreflight({ operator: event.target.value })}
        placeholder="Person completing preflight" /></label>
      <p><strong>Final summary: {reportBlockers ? "REVIEW REQUIRED" :
        allSignedChecks ? "READY FOR OPERATOR SIGN-OFF" : "CHECKLIST INCOMPLETE"}</strong></p>
      {reportBlockers && <p role="alert">Automated checks contain missing, stale, warning, or failed
        results. Resolve them and generate a fresh report before signing off.</p>}
      <button type="button" disabled={reportBlockers || !allSignedChecks || !preflight.operator.trim()}
        onClick={signOff}>Sign off pre-event checks</button>
      {preflight.signedAt && <p>Signed by {preflight.operator} at
        {" "}{new Date(preflight.signedAt).toLocaleString()}.
        {reportBlockers ? " Current automated checks require revalidation." : ""}</p>}
      <p>Sign-off is a local operator acknowledgement, not cryptographic authentication.
        Changes to checklist entries or a new report invalidate the existing sign-off.</p>
      <button type="button" onClick={download}>Download Hardware Report JSON</button>
    </div>}
  </section>;
}
