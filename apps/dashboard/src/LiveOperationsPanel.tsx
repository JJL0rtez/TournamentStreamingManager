import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from "react";

type Severity = "critical" | "warning" | "ok";
type Row = { cameraId: string; ring: string; cameraName: string; severity: Severity;
  capture: string; recording: string; relay: string; captureMode: string | null; frameAgeMs: number | null;
  pendingRecovery: boolean; recoveryAttempts: number; nextRetryAt: string | null; issues: string[] };
type Snapshot = { checkedAt: string; scope: string; eventName: string | null; configured: boolean;
  counts: { assigned: number; critical: number; warning: number; ok: number }; rows: Row[];
  unassignedActiveCaptures: string[]; unassignedActiveRelays: string[]; youtubeVerified: false; note: string };

/** A read-only operational snapshot. Does not start or stop streams, or claim YouTube playback health. */
export function LiveOperationsPanel({ requestNode }: { requestNode: (url: string, options?: RequestInit) => Promise<any> }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const result: Snapshot = await requestNode("/api/operations/live-readiness"); setSnapshot(result); setError(""); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }, [requestNode]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try { const result: Snapshot = await requestNode("/api/operations/live-readiness");
        if (active) { setSnapshot(result); setError(""); } }
      catch (cause) { if (active) setError(String(cause)); }
    };
    const timer = startPolling(poll, 10_000);
    return () => { active = false; timer(); };
  }, [requestNode]);
  function exportCsv() {
    if (!snapshot) return;
    // Prevent spreadsheet programs from executing formulas in operator-supplied labels.
    const cells = (values: Array<string | number | null | boolean>) => values.map(value => {
      const original = String(value ?? "");
      const safe = /^[\s]*[=+@-]/.test(original) ? `'${original}` : original;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(",");
    const header = cells(["Checked At", "Event", "Ring", "Camera ID", "Camera", "Severity", "Capture", "Recording", "Relay (local)", "Mode", "Last frame age (ms)", "Recovery pending", "Recovery attempts", "Issues"]);
    const lines = snapshot.rows.map(row => cells([snapshot.checkedAt, snapshot.eventName, row.ring,
      row.cameraId, row.cameraName, row.severity, row.capture, row.recording, row.relay, row.captureMode,
      row.frameAgeMs, row.pendingRecovery, row.recoveryAttempts, row.issues.join("; ")]));
    const blob = new Blob(["\uFEFF", header, "\r\n", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `tournament-local-readiness-${snapshot.checkedAt.slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  const displayed = snapshot?.rows.filter(row => filter === "all" || row.severity === filter) ?? [];
  const stale = snapshot ? Date.now() - Date.parse(snapshot.checkedAt) > 30_000 : false;
  return <section className="overview" aria-label="Live tournament operations snapshot">
    <h3>Local ring operations snapshot</h3>
    <p className="muted">Assigned ring coverage, recording, local relay health and pending retries. This does not verify YouTube audience playback.</p>
    <div className="field">
      <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing..." : "Refresh snapshot"}</button>{" "}
      <button type="button" disabled={!snapshot} onClick={exportCsv}>Export CSV</button>{" "}
      <label>Show <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
        <option value="all">All rings</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="ok">No local issues</option>
      </select></label>
    </div>
    {error && <p role="alert">Local readiness unavailable: {error}. Last successful snapshot, if shown, may be stale.</p>}
    {snapshot && <>
      <p><strong>{snapshot.eventName ?? "No event selected"}</strong> | {snapshot.counts.assigned} assigned | {snapshot.counts.critical} critical | {snapshot.counts.warning} warning | {snapshot.counts.ok} with no local issues</p>
      <p className="muted">Checked {new Date(snapshot.checkedAt).toLocaleString()}{stale ? ". Snapshot older than 30 seconds." : ""}</p>
      {!snapshot.configured && <p role="status">No ring assignments configured. Configure the tournament session before using this checklist.</p>}
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Ring</th><th>Camera</th><th>Status</th><th>Capture</th><th>Recording</th><th>Relay (local)</th><th>Recovery</th><th>Issues</th></tr></thead>
        <tbody>{displayed.map(row => <tr key={row.cameraId}><td>{row.ring}</td><td>{row.cameraName} <small>({row.cameraId})</small></td>
          <td>{row.severity}</td><td>{row.capture}</td><td>{row.recording}</td><td>{row.relay}</td>
          <td>{row.pendingRecovery ? `Pending (${row.recoveryAttempts} attempts)` : "None pending"}</td>
          <td>{row.issues.length ? row.issues.join("; ") : "No local issues detected"}</td></tr>)}</tbody></table></div>
      {displayed.length === 0 && snapshot.configured && <p>No rings match this filter.</p>}
      {snapshot.unassignedActiveCaptures.length > 0 && <p role="alert">Unassigned active captures: {snapshot.unassignedActiveCaptures.join(", ")}</p>}
      {snapshot.unassignedActiveRelays.length > 0 && <p role="alert">Unassigned active relays: {snapshot.unassignedActiveRelays.join(", ")}</p>}
      <p className="muted">{snapshot.note}</p>
    </>}
  </section>;
}
