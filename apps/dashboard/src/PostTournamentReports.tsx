import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CameraReliabilitySummary } from "./CameraReliabilityPanels";
import { type IncidentEntry } from "./dashboard-shared";
import { type SavedGuidedTest, classifyTroubleshootingChange, readGuidedHistory } from "./GuidedTroubleshooting";

export type PostTournamentReport = {
  generatedAt: string; nodeId: string; eventId: string; eventName: string;
  incidents: { total: number; interrupted: number; degraded: number; unresolved: number;
    averageResolutionMinutes: number | null; byRing: Array<{ ring: string; incidents: number; interrupted: number }> };
  recordings: { total: number; completed: number; failed: number; activeOrUnknown: number;
    byCamera: Array<{ cameraId: string; cameraName: string; completed: number; failed: number; activeOrUnknown: number }> };
  usb: { observedDisconnects: number; byCamera: Array<{ cameraId: string; cameraName: string; disconnects: number }>;
    scope: string };
  troubleshooting: { worksheets: number; withRecordedChanges: number; byCategory: Array<{ category: string; count: number }> };
  limitations: string[];
};

export const POST_TOURNAMENT_COMPARISON_KEY = "tournament-post-technical-snapshots-v1";

export function readPostTournamentSnapshots(): PostTournamentReport[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POST_TOURNAMENT_COMPARISON_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PostTournamentReport => {
      if (!value || typeof value !== "object") return false;
      const r = value as Partial<PostTournamentReport>;
      return typeof r.nodeId === "string" && typeof r.eventId === "string" &&
        typeof r.generatedAt === "string" && Number.isFinite(Date.parse(r.generatedAt)) &&
        !!r.incidents && typeof r.incidents.interrupted === "number" &&
        !!r.recordings && typeof r.recordings.failed === "number" &&
        typeof r.recordings.total === "number" && !!r.usb &&
        typeof r.usb.observedDisconnects === "number";
    }).slice(0, 30);
  } catch { return []; }
}

export function TournamentToTournamentComparison() {
  const [snapshots, setSnapshots] = useState<PostTournamentReport[]>(readPostTournamentSnapshots);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [message, setMessage] = useState("");
  const keyFor = (r: PostTournamentReport) => `${r.nodeId}|${r.eventId}|${r.generatedAt}`;
  const a = snapshots.find(r => keyFor(r) === first);
  const b = snapshots.find(r => keyFor(r) === second);
  const metrics = a && b ? [
    { label: "Reported incidents", before: a.incidents.total, after: b.incidents.total },
    { label: "Reported interruptions", before: a.incidents.interrupted, after: b.incidents.interrupted },
    { label: "Unresolved incidents", before: a.incidents.unresolved, after: b.incidents.unresolved },
    { label: "Failed recordings", before: a.recordings.failed, after: b.recordings.failed },
    { label: "Recording sessions", before: a.recordings.total, after: b.recordings.total },
    { label: "Recording failure rate (%)", before: a.recordings.total ? a.recordings.failed / a.recordings.total * 100 : null,
      after: b.recordings.total ? b.recordings.failed / b.recordings.total * 100 : null },
    { label: "Average operator closure (min)", before: a.incidents.averageResolutionMinutes,
      after: b.incidents.averageResolutionMinutes },
    { label: "Node-wide USB disconnects (not event-specific)", before: a.usb.observedDisconnects,
      after: b.usb.observedDisconnects }
  ] : [];
  const format = (n: number | null) => n === null ? "N/A" : Number(n.toFixed(2)).toString();
  const refresh = () => { setSnapshots(readPostTournamentSnapshots()); setMessage(""); };
  const exportComparison = () => {
    if (!a || !b || first === second) return;
    const payload = { exportedAt: new Date().toISOString(), baseline: a, comparison: b, metrics,
      limitations: ["Snapshots are saved in this browser only and limited to 30.",
        "Recording counts use a bounded journal, so events with more than 200 sessions can be undercounted.",
        "USB history is node-wide, not event-specific; its counts must not be used as event reliability scores.",
        "Troubleshooting worksheets are not event-scoped; incident resolution times are operator-reported.",
        "Different event durations and recording volumes make raw incident counts non-comparable."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tournament-reliability-comparison.json";
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="session-panel" aria-label="Tournament-to-tournament reliability comparison">
    <h3>Tournament-to-tournament reliability comparison</h3>
    <p className="muted">Compare saved post-tournament technical report snapshots. Save a report after each event;
      comparisons remain in this browser and are not shared with other dashboards.</p>
    <button type="button" onClick={refresh}>Refresh saved reports</button>
    {snapshots.length === 0 && <p>No saved reports yet. Generate a post-tournament technical report and click Save comparison snapshot.</p>}
    {snapshots.length > 0 && <>
      <label>Baseline event <select value={first} onChange={e => setFirst(e.target.value)}>
        <option value="">Choose baseline</option>
        {snapshots.map(r => <option key={keyFor(r)} value={keyFor(r)}>{r.eventName || r.eventId} ({r.nodeId}, {new Date(r.generatedAt).toLocaleString()})</option>)}
      </select></label>{" "}
      <label>Comparison event <select value={second} onChange={e => setSecond(e.target.value)}>
        <option value="">Choose comparison</option>
        {snapshots.map(r => <option key={keyFor(r)} value={keyFor(r)}>{r.eventName || r.eventId} ({r.nodeId}, {new Date(r.generatedAt).toLocaleString()})</option>)}
      </select></label>
      <button type="button" disabled={!a || !b || first === second} onClick={exportComparison}>Export comparison JSON</button>
      <button type="button" disabled={!first && !second} onClick={() => {
        const remove = first || second;
        const next = snapshots.filter(r => keyFor(r) !== remove);
        try { localStorage.setItem(POST_TOURNAMENT_COMPARISON_KEY, JSON.stringify(next)); setSnapshots(next);
          if (first === remove) setFirst(""); if (second === remove) setSecond(""); setMessage("Snapshot deleted."); }
        catch { setMessage("Unable to update browser storage."); }
      }}>Delete selected baseline (or comparison)</button>
    </>}
    {message && <p role="status">{message}</p>}
    {a && b && first !== second && <>
      <h4>{a.eventName || a.eventId} versus {b.eventName || b.eventId}</h4>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Metric</th><th>Baseline</th><th>Comparison</th><th>Difference</th></tr></thead><tbody>
        {metrics.map(m => <tr key={m.label}><td>{m.label}</td><td>{format(m.before)}</td>
          <td>{format(m.after)}</td><td>{m.before === null || m.after === null ? "N/A" : format(m.after - m.before)}</td></tr>)}
      </tbody></table></div>
      <p className="muted">A lower count does not establish improved reliability. Event lengths and recording volumes may differ;
        USB counts cover retained node-wide observations, not the selected event. Historical data may be truncated.</p>
    </>}
  </section>;
}

export function TournamentReliabilityTrends() {
  const [snapshots, setSnapshots] = useState<PostTournamentReport[]>(readPostTournamentSnapshots);
  const [nodeFilter, setNodeFilter] = useState("all");
  const [metric, setMetric] = useState<"failureRate" | "interruptions" | "incidents" | "recovery">("failureRate");
  const nodes = [...new Set(snapshots.map(s => s.nodeId))].sort();
  const visible = snapshots.filter(s => nodeFilter === "all" || s.nodeId === nodeFilter)
    .slice().sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const values = visible.map(s => {
    if (metric === "failureRate") return s.recordings.total > 0 ? s.recordings.failed / s.recordings.total * 100 : null;
    if (metric === "interruptions") return s.incidents.interrupted;
    if (metric === "incidents") return s.incidents.total;
    return s.incidents.averageResolutionMinutes;
  });
  const available = values.filter((n): n is number => n !== null && Number.isFinite(n));
  const max = Math.max(1, ...available);
  const metricLabel = { failureRate: "Recording failure rate (%)", interruptions: "Reported interruptions",
    incidents: "Reported incidents", recovery: "Average operator closure (minutes)" }[metric];
  const exportTrends = () => {
    const payload = { exportedAt: new Date().toISOString(), metric, metricLabel, nodeFilter,
      events: visible.map((s, i) => ({ nodeId: s.nodeId, eventId: s.eventId, eventName: s.eventName,
        generatedAt: s.generatedAt, value: values[i], recordingSessions: s.recordings.total,
        failedRecordings: s.recordings.failed, reportedIncidents: s.incidents.total,
        interruptions: s.incidents.interrupted, averageClosureMinutes: s.incidents.averageResolutionMinutes })),
      limitations: ["Browser-local snapshots, maximum 30 across nodes.",
        "Recording journal retains at most 200 sessions; failure rates may be incomplete.",
        "Incident counts are operator-reported, not normalized by tournament duration.",
        "Resolution times reflect operator closure, not measured stream downtime.",
        "Snapshots are ordered by report generation time, not necessarily event date.",
        "Node comparisons may reflect different hardware and workloads."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tournament-reliability-trends.json";
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="session-panel" aria-label="Tournament reliability trends">
    <h3>Multi-tournament reliability trends</h3>
    <p className="muted">Visualize saved post-tournament snapshots in report-generation order. Refresh after saving a new snapshot.
      Each event contributes one saved snapshot per node.</p>
    <button type="button" onClick={() => setSnapshots(readPostTournamentSnapshots())}>Refresh trends</button>{" "}
    <label>Capture node <select value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}>
      <option value="all">All nodes</option>{nodes.map(n => <option key={n} value={n}>{n}</option>)}
    </select></label>{" "}
    <label>Metric <select value={metric} onChange={e => setMetric(e.target.value as typeof metric)}>
      <option value="failureRate">Recording failure rate (%)</option>
      <option value="interruptions">Reported interruptions</option>
      <option value="incidents">Reported incidents</option>
      <option value="recovery">Average operator closure (minutes)</option>
    </select></label>{" "}
    <button type="button" disabled={!visible.length} onClick={exportTrends}>Export trends JSON</button>
    {visible.length === 0 ? <p>No saved snapshots for this node. Generate and save post-tournament reports first.</p> : <>
      <p><strong>{metricLabel}</strong> across {visible.length} saved tournament{visible.length === 1 ? "" : "s"}</p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", minHeight: 165,
        overflowX: "auto", padding: "0.75rem 0", borderBottom: "1px solid #888" }} role="img"
        aria-label={`${metricLabel} by saved tournament, with exact values in the table below`}>
        {visible.map((s, i) => <div key={`${s.nodeId}:${s.eventId}:${s.generatedAt}`}
          title={`${s.eventName || s.eventId}: ${values[i] === null ? "N/A" : values[i]?.toFixed(2)}`}
          style={{ minWidth: 72, maxWidth: 120, flex: "1 0 72px", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "flex-end", height: 150 }}>
          <small>{values[i] === null ? "N/A" : values[i]?.toFixed(1)}</small>
          <div style={{ background: "#4b86b4", width: "65%", minHeight: values[i] === null ? 0 : 2,
            height: values[i] === null ? 0 : `${Math.max(2, values[i]! / max * 112)}px` }} />
          <small style={{ textAlign: "center", overflowWrap: "anywhere" }}>{s.eventName || s.eventId}</small>
        </div>)}
      </div>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Report date</th><th>Node</th><th>Event</th>
        <th>{metricLabel}</th><th>Recording sessions</th></tr></thead><tbody>
        {visible.map((s, i) => <tr key={`${s.nodeId}:${s.eventId}:${s.generatedAt}`}>
          <td>{new Date(s.generatedAt).toLocaleString()}</td><td>{s.nodeId}</td><td>{s.eventName || s.eventId}</td>
          <td>{values[i] === null ? "N/A" : values[i]?.toFixed(2)}</td><td>{s.recordings.total}</td>
        </tr>)}
      </tbody></table></div>
    </>}
    <p className="muted">Trends are descriptive, not proof of improved reliability. Events may have different durations,
      camera counts and workloads. Recording history is bounded; browser-local incident logs and snapshots may be incomplete.
      USB observations are intentionally excluded because they are node-wide rather than event-specific.</p>
  </section>;
}

export function PostTournamentTechnicalReport({ nodeId, eventId, eventName, requestNode }: {
  nodeId: string; eventId: string; eventName: string;
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<PostTournamentReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  function saveSnapshot() {
    if (!report) return;
    try {
      const existing = readPostTournamentSnapshots();
      const next = [report, ...existing.filter(r => !(r.nodeId === report.nodeId && r.eventId === report.eventId))].slice(0, 30);
      localStorage.setItem(POST_TOURNAMENT_COMPARISON_KEY, JSON.stringify(next));
      setSavedMessage("Saved this event snapshot for tournament comparisons.");
    } catch { setSavedMessage("Unable to save snapshot. Export the JSON instead."); }
  }
  async function generate() {
    if (!eventId || busy) return;
    setBusy(true); setError(""); setReport(null);
    try {
      // Request bounded, existing node-side histories. Browser incident history is scoped to this node/event.
      const [historyResponse, reliability] = await Promise.all([
        requestNode("/api/recording-history?limit=200") as Promise<{ sessions: Array<{
          eventId?: string; cameraId: string; cameraName: string; outcome: string }> }>,
        requestNode("/api/camera-health/reliability-summary") as Promise<CameraReliabilitySummary>
      ]);
      const raw = localStorage.getItem(`tournament-incident-log-v1:${nodeId}:${eventId}`);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const incidents: IncidentEntry[] = Array.isArray(parsed) ? parsed.filter((item): item is IncidentEntry =>
        !!item && typeof item === "object" && typeof item.id === "string" &&
        typeof item.timestamp === "string") : [];
      const recordings = (Array.isArray(historyResponse.sessions) ? historyResponse.sessions : [])
        .filter(session => session.eventId === eventId);
      const byRing = new Map<string, { ring: string; incidents: number; interrupted: number }>();
      let interrupted = 0, degraded = 0, unresolved = 0, resolutionSum = 0, resolvedCount = 0;
      for (const item of incidents) {
        const ring = item.ring?.trim() || "Unassigned";
        const row = byRing.get(ring) || { ring, incidents: 0, interrupted: 0 };
        row.incidents++;
        if (item.impact === "interrupted") { interrupted++; row.interrupted++; }
        if (item.impact === "degraded") degraded++;
        if (!item.resolvedAt) unresolved++;
        else {
          const duration = Date.parse(item.resolvedAt) - Date.parse(item.timestamp);
          if (Number.isFinite(duration) && duration >= 0) { resolutionSum += duration; resolvedCount++; }
        }
        byRing.set(ring, row);
      }
      const byCamera = new Map<string, { cameraId: string; cameraName: string;
        completed: number; failed: number; activeOrUnknown: number }>();
      let completed = 0, failed = 0, activeOrUnknown = 0;
      for (const session of recordings) {
        const row = byCamera.get(session.cameraId) || { cameraId: session.cameraId,
          cameraName: session.cameraName || session.cameraId, completed: 0, failed: 0, activeOrUnknown: 0 };
        if (session.outcome === "stopped") { completed++; row.completed++; }
        else if (session.outcome === "failed") { failed++; row.failed++; }
        else { activeOrUnknown++; row.activeOrUnknown++; }
        byCamera.set(session.cameraId, row);
      }
      const worksheets = readGuidedHistory();
      const categories = new Map<string, number>();
      for (const item of worksheets) {
        const category = classifyTroubleshootingChange(item.changeMade || "");
        categories.set(category, (categories.get(category) || 0) + 1);
      }
      setReport({ generatedAt: new Date().toISOString(), nodeId, eventId, eventName,
        incidents: { total: incidents.length, interrupted, degraded, unresolved,
          averageResolutionMinutes: resolvedCount ? Math.round(resolutionSum / resolvedCount / 6000) / 10 : null,
          byRing: [...byRing.values()].sort((a, b) => b.incidents - a.incidents) },
        recordings: { total: recordings.length, completed, failed, activeOrUnknown,
          byCamera: [...byCamera.values()].sort((a, b) => b.failed - a.failed) },
        usb: { observedDisconnects: reliability.totals.usbDisconnects,
          byCamera: reliability.cameras.filter(c => c.usbDisconnects > 0).map(c => ({
            cameraId: c.cameraId, cameraName: c.cameraName, disconnects: c.usbDisconnects })),
          scope: "Node-wide retained USB history, not restricted to this tournament" },
        troubleshooting: { worksheets: worksheets.length,
          withRecordedChanges: worksheets.filter(w => !!w.changeMade?.trim()).length,
          byCategory: [...categories].map(([category, count]) => ({ category, count })) },
        limitations: [
          "Recording totals are limited to the latest 200 node journal sessions and filtered by event ID.",
          "USB disconnects are node-wide observations from the latest 1000 sampled transitions, not event-specific.",
          "Troubleshooting worksheets are browser-local, limited to 30, and are not reliably event-scoped.",
          "Incident records are browser-local for this event and node and capped at 300.",
          "Resolution time is based on operator closure; it does not measure actual stream downtime.",
          "This report is a snapshot. Missing history is not evidence that no incidents occurred."
        ] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `post-tournament-technical-${report.eventId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${report.generatedAt.slice(0, 10)}.json`;
    link.click(); URL.revokeObjectURL(url);
  }
  return <section className="session-panel" aria-label="Post-tournament technical report">
    <h3>Post-tournament technical report</h3>
    <p className="muted">Combine this event's browser incident log and recording journal with node-wide USB observations and browser troubleshooting history. Generate after the event for the most complete retained snapshot.</p>
    {!eventId && <p className="muted">Save or select a tournament event to generate its report.</p>}
    <button type="button" disabled={!eventId || busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate technical report"}</button>{" "}
    {report && <><button type="button" onClick={download}>Export report JSON</button>{" "}
      <button type="button" onClick={saveSnapshot}>Save comparison snapshot</button></>}
    {savedMessage && <p role="status">{savedMessage}</p>}
    {error && <p role="alert" className="camera-warning">Report generation failed: {error}</p>}
    {report && <>
      <p><strong>{report.eventName || report.eventId}</strong> · Generated {new Date(report.generatedAt).toLocaleString()}</p>
      <div className="overview">
        <div className="metric"><span>Reported incidents</span><strong>{report.incidents.total}</strong></div>
        <div className="metric"><span>Interruptions</span><strong>{report.incidents.interrupted}</strong></div>
        <div className="metric"><span>Failed recordings</span><strong>{report.recordings.failed}</strong></div>
        <div className="metric"><span>Node-wide USB disconnects</span><strong>{report.usb.observedDisconnects}</strong></div>
      </div>
      <p>Incidents: {report.incidents.degraded} degraded, {report.incidents.unresolved} unresolved.
        Average operator closure: {report.incidents.averageResolutionMinutes === null ? "unavailable" : `${report.incidents.averageResolutionMinutes} minutes`}.</p>
      <p>Event recordings: {report.recordings.completed} completed, {report.recordings.failed} failed,
        {report.recordings.activeOrUnknown} active or unknown. Troubleshooting worksheets: {report.troubleshooting.worksheets} browser-local.</p>
      <h4>Incidents by ring</h4>
      {report.incidents.byRing.length ? <div style={{ overflowX: "auto" }}><table><thead><tr><th>Ring</th><th>Incidents</th><th>Interruptions</th></tr></thead><tbody>
        {report.incidents.byRing.map(r => <tr key={r.ring}><td>{r.ring}</td><td>{r.incidents}</td><td>{r.interrupted}</td></tr>)}
      </tbody></table></div> : <p className="muted">No retained incident records for this event.</p>}
      <h4>Recording outcomes by camera</h4>
      {report.recordings.byCamera.length ? <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Completed</th><th>Failed</th><th>Active / unknown</th></tr></thead><tbody>
        {report.recordings.byCamera.map(c => <tr key={c.cameraId}><td>{c.cameraName}</td><td>{c.completed}</td><td>{c.failed}</td><td>{c.activeOrUnknown}</td></tr>)}
      </tbody></table></div> : <p className="muted">No event-tagged sessions in retained recording history.</p>}
      <h4>Report coverage and limitations</h4><ul>{report.limitations.map(note => <li key={note}>{note}</li>)}</ul>
    </>}
  </section>;
}
