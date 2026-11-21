import { OperationsAlertHistory, type OperationsAlertInput, type OperationsAlertSeverity, type OperationsAlertRecord } from "./OperationsAlertHistory";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type IncidentEntry, type RecordingSummary, fileSize } from "./dashboard-shared";

export interface CameraQualitySnapshot {
  width: number;
  height: number;
  fps: number;
  recordingBitrateMbps: number;
  streamingBitrateKbps: number;
}

export function validCameraQuality(value: unknown): value is CameraQualitySnapshot {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return ["width", "height", "fps", "recordingBitrateMbps", "streamingBitrateKbps"]
    .every(key => typeof q[key] === "number" && Number.isFinite(q[key]) && (q[key] as number) > 0);
}

export function TournamentTechnicalSummary({ nodeId, eventId, eventName, requestNode }: {
  nodeId: string; eventId: string; eventName: string;
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  type TechnicalReport = {
    generatedAt: string; nodeId: string; eventId: string; eventName: string;
    recording: RecordingSummary; inventory: Array<{
      cameraId: string; cameraName: string; ring: string | null; recordingPath: string;
      startedAt: string; endedAt?: string; outcome: string; active: boolean;
      captureConfiguration?: {
        requested: CameraQualitySnapshot;
        actualInput: { width: number; height: number; fps: number; format: string };
        source: "recording-start";
      };
      integrity: { status: string; issues: string[]; segments: Array<{ name: string; bytes: number }>;
        totalBytes?: number };
    }>;
    inventoryScope: string; alerts: OperationsAlertRecord[];
    incidents: IncidentEntry[]; stressTests: Array<{ label: string; startedAt: string; cameraCount: number }>;
    limitations: string[];
    qualitySnapshot?: Record<string, CameraQualitySnapshot>;
  };
  const [report, setReport] = useState<TechnicalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true); setError(""); setReport(null);
    try {
      const recording: RecordingSummary = await requestNode(`/api/recording-history/summary?eventId=${encodeURIComponent(eventId)}`);
      // Read the same capped backend journal used by the recording summary.
      // Never treat entries without matching event snapshots as part of this event.
      const history: { sessions: Array<{
        cameraId: string; cameraName: string; ring?: string | null; eventId?: string;
        recordingPath: string; startedAt: string; endedAt?: string; outcome: string;
        captureConfiguration?: {
          requested: CameraQualitySnapshot;
          actualInput: { width: number; height: number; fps: number; format: string };
          source: "recording-start";
        };
        integrity: { status: string; issues: string[];
          segments: Array<{ name: string; bytes: number }>; totalBytes?: number };
      }> } = await requestNode("/api/recording-history?limit=200");
      const inventory = history.sessions.filter(item => item.eventId === eventId)
        .map(item => ({ ...item, ring: item.ring ?? null,
          active: !item.endedAt && item.outcome === "started" }));
      const suffix = `${nodeId}:${eventId || "unsaved"}`;
      const readArray = (key: string): unknown[] => {
        try { const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
          return Array.isArray(value) ? value : []; } catch { return []; }
      };
      const alerts = readArray(`tournament-operations-alerts-v1:${suffix}`)
        .filter((a): a is OperationsAlertRecord => !!a && typeof a === "object" &&
          typeof (a as OperationsAlertRecord).firstSeen === "string" &&
          typeof (a as OperationsAlertRecord).key === "string");
      const incidents = readArray(`tournament-incident-log-v1:${suffix}`)
        .filter((i): i is IncidentEntry => !!i && typeof i === "object" &&
          typeof (i as IncidentEntry).timestamp === "string" &&
          typeof (i as IncidentEntry).id === "string");
      const stressTests = readArray("tournament-stress-history-v1")
        .filter((item): item is { label: string; report: { startedAt: string; cameraResults: unknown[] } } =>
          !!item && typeof item === "object" && typeof (item as any).label === "string" &&
          !!(item as any).report && typeof (item as any).report.startedAt === "string" &&
          Array.isArray((item as any).report.cameraResults))
        .map(item => ({ label: item.label, startedAt: item.report.startedAt,
          cameraCount: item.report.cameraResults.length }));
      // Capture the *current* configured settings at report generation time.
      // These are NOT guaranteed to be the settings used for earlier sessions.
      const qualitySnapshot: Record<string, CameraQualitySnapshot> = {};
      const cameraIds = [...new Set(recording.cameras.map(camera => camera.cameraId))].slice(0, 16);
      await Promise.all(cameraIds.map(async cameraId => {
        try {
          const result: { quality?: unknown } = await requestNode(
            `/api/camera-quality/${encodeURIComponent(cameraId)}`);
          if (validCameraQuality(result.quality)) qualitySnapshot[cameraId] = result.quality;
        } catch { /* Missing settings are represented as unknown, never invented. */ }
      }));
      const completedReport: TechnicalReport = { generatedAt: new Date().toISOString(), nodeId, eventId, eventName,
        recording, inventory, qualitySnapshot, inventoryScope: "Most recent 200 recording sessions in node journal", alerts, incidents, stressTests,
        limitations: [
          "Alert and incident history is stored only in this browser; other operators' browsers are not included.",
          "Stress tests are browser-local and are not reliably attributed to a particular event; they are shown as contextual tests only.",
          "YouTube interruptions are inferred from saved relay alerts, not verified from YouTube playback or complete streaming logs.",
          "Recording history and inventory are limited to the 200 most recent sessions scanned by the backend.",
          "An active flag in the exported inventory is inferred from journal state; verify current capture status before relying on it.",
          "Recording paths may contain local directory information. Treat exported reports as operational records.",
          "Generating this report does not verify file integrity beyond the backend recording summary checks.",
          "Current camera quality snapshots reflect settings at report generation time, not historical settings.",
          "Per-session recording-start configurations are available only for sessions started after Milestone 59; older sessions have unknown configurations.",
          "The input mode is the mode requested from FFmpeg based on device probing, not independently measured frame delivery."
        ] };
      setReport(completedReport);
      // Explicit snapshot archive. Capped to prevent unbounded browser storage use.
      try {
        const key = "tournament-event-report-archive-v1";
        const existing: unknown = JSON.parse(localStorage.getItem(key) || "[]");
        const previous = Array.isArray(existing) ? existing : [];
        localStorage.setItem(key, JSON.stringify([completedReport, ...previous].slice(0, 15)));
        window.dispatchEvent(new Event("tournament-report-archive-updated"));
      } catch { /* localStorage quota or privacy mode: report remains available for download */ }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function download(format: "json" | "csv") {
    if (!report) return;
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows: unknown[][] = [["Section", "Item", "Metric", "Value"]];
    const add = (section: string, item: string, metric: string, value: unknown) => rows.push([section, item, metric, value]);
    for (const [key, value] of Object.entries(report.recording.totals)) add("Recording totals", "All cameras", key, value);
    for (const camera of report.recording.cameras) {
      for (const [key, value] of Object.entries(camera)) add("Camera", camera.ring || camera.cameraName, key, value);
    }
    for (const item of report.inventory) {
      const key = item.ring || item.cameraName;
      add("Recording inventory", key, "Camera ID", item.cameraId);
      add("Recording inventory", key, "Recording path", item.recordingPath);
      add("Recording inventory", key, "Started", item.startedAt);
      add("Recording inventory", key, "Ended", item.endedAt || "Unknown / ongoing");
      add("Recording inventory", key, "Outcome", item.outcome);
      if (item.captureConfiguration?.source === "recording-start") {
        const config = item.captureConfiguration;
        add("Recording-start configuration", item.recordingPath, "Requested resolution", `${config.requested.width}x${config.requested.height}`);
        add("Recording-start configuration", item.recordingPath, "Requested FPS", config.requested.fps);
        add("Recording-start configuration", item.recordingPath, "Input resolution", `${config.actualInput.width}x${config.actualInput.height}`);
        add("Recording-start configuration", item.recordingPath, "Input FPS", config.actualInput.fps);
        add("Recording-start configuration", item.recordingPath, "Input format", config.actualInput.format);
        add("Recording-start configuration", item.recordingPath, "Recording Mbps", config.requested.recordingBitrateMbps);
        add("Recording-start configuration", item.recordingPath, "Streaming kbps", config.requested.streamingBitrateKbps);
      }
      add("Recording inventory", key, "Segment count", item.integrity.segments.length);
      add("Recording inventory", key, "Bytes", item.integrity.totalBytes ?? item.integrity.segments.reduce((sum, seg) => sum + seg.bytes, 0));
      add("Recording inventory", key, "Integrity", item.integrity.status);
      add("Recording inventory", key, "Issues", item.integrity.issues.join("; "));
    }
    for (const alert of report.alerts) {
      add("Alert", alert.key, "Severity", alert.severity);
      add("Alert", alert.key, "Detected", alert.firstSeen);
      add("Alert", alert.key, "Resolved", alert.resolvedAt || "Open");
      add("Alert", alert.key, "Description", alert.message);
    }
    for (const incident of report.incidents) {
      add("Incident", incident.id, "Created", incident.timestamp);
      add("Incident", incident.id, "Description", incident.description);
      add("Incident", incident.id, "Resolved", incident.resolvedAt || "Open");
      add("Incident", incident.id, "Resolution", incident.resolution);
    }
    for (const test of report.stressTests) add("Stress test (unattributed)", test.label, test.startedAt, test.cameraCount);
    for (const [cameraId, q] of Object.entries(report.qualitySnapshot || {})) {
      add("Current camera configuration snapshot", cameraId, "Resolution", `${q.width}x${q.height}`);
      add("Current camera configuration snapshot", cameraId, "Capture FPS", q.fps);
      add("Current camera configuration snapshot", cameraId, "Recording Mbps", q.recordingBitrateMbps);
      add("Current camera configuration snapshot", cameraId, "Streaming kbps", q.streamingBitrateKbps);
    }
    for (const note of report.limitations) add("Limitation", "", "Note", note);
    const safeCell = (value: unknown) => {
      const content = String(value ?? "");
      // Prevent spreadsheet formula injection when reports are opened in Excel.
      return quote(/^\s*[=+@-]/.test(content) ? "'" + content : content);
    };
    const contents = format === "json" ? JSON.stringify(report, null, 2) :
      "\uFEFF" + rows.map(row => row.map(safeCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([contents], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `tournament-event-report-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Post-tournament technical summary">
    <div className="section-heading"><h3>Consolidated tournament event report</h3></div>
    <p className="muted">Generate an event-scoped recording summary alongside alerts and incidents saved in this browser.
      This is a retrospective snapshot, not a live health check.</p>
    <button onClick={generate} disabled={busy || !eventId}>{busy ? "Generating..." : "Generate technical summary"}</button>
    {!eventId && <p className="muted">Save or select a tournament event to generate its summary.</p>}
    {error && <p role="alert" className="camera-warning">{error}</p>}
    {report && <>
      <p><strong>{report.eventName || report.eventId}</strong> | Generated {new Date(report.generatedAt).toLocaleString()}</p>
      <div className="overview">
        <div className="metric"><span>Recording sessions</span><strong>{report.recording.totals.sessions}</strong></div>
        <div className="metric"><span>Recording failures</span><strong>{report.recording.totals.failures}</strong></div>
        <div className="metric"><span>Recording warnings</span><strong>{report.recording.totals.warnings}</strong></div>
        <div className="metric"><span>Saved alerts</span><strong>{report.alerts.length}</strong></div>
        <div className="metric"><span>Open incidents</span><strong>{report.incidents.filter(i => !i.resolvedAt).length}</strong></div>
      </div>
      <h4>Recording reliability by ring</h4>
      <table><thead><tr><th>Ring / Camera</th><th>Sessions</th><th>Failures</th><th>Warnings</th><th>Segments</th><th>Recorded data</th></tr></thead>
        <tbody>{report.recording.cameras.map((c, index) => <tr key={`${c.cameraId}:${c.ring}:${index}`}>
          <td>{c.ring || "Unattributed"} / {c.cameraName}</td><td>{c.sessions}</td><td>{c.failures}</td>
          <td>{c.warnings}</td><td>{c.segments}</td><td>{fileSize(c.bytes)}</td>
        </tr>)}</tbody></table>
      <h4>Recording-start configuration history</h4>
      <p className="muted">Values are captured when each recording starts. Older sessions display Unknown.
        The input mode is requested from FFmpeg and does not prove delivered frame rate.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Started</th>
        <th>Input mode</th><th>Recording bitrate</th><th>Outcome</th></tr></thead><tbody>
        {report.inventory.map(item => <tr key={item.recordingPath}>
          <td>{item.ring || item.cameraName}</td><td>{item.startedAt}</td>
          <td>{item.captureConfiguration?.source === "recording-start"
            ? `${item.captureConfiguration.actualInput.width}x${item.captureConfiguration.actualInput.height} @ ${item.captureConfiguration.actualInput.fps} fps`
            : "Unknown (legacy recording)"}</td>
          <td>{item.captureConfiguration?.requested.recordingBitrateMbps != null
            ? `${item.captureConfiguration.requested.recordingBitrateMbps} Mbps` : "Unknown"}</td>
          <td>{item.outcome}</td>
        </tr>)}</tbody></table></div>
      <h4>Recording inventory ({report.inventory.length} sessions)</h4>
      <p className="muted">Event-matched sessions from the node journal, capped at the latest 200 sessions.
        Integrity checks cover file presence, sequence, and nonzero size, not playable video or audio.</p>
      {report.inventory.length === 0 ? <p>No matching recording sessions found in the recent journal.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Ring / Camera</th><th>Started</th>
          <th>Outcome</th><th>Segments</th><th>Size</th><th>Integrity</th><th>File path</th></tr></thead>
          <tbody>{report.inventory.map(item => <tr key={item.recordingPath}>
            <td>{item.ring || "Unattributed"} / {item.cameraName}</td>
            <td>{new Date(item.startedAt).toLocaleString()}</td><td>{item.outcome}</td>
            <td>{item.integrity.segments.length}</td>
            <td>{fileSize(item.integrity.totalBytes ?? 0)}</td>
            <td>{item.integrity.status}{item.integrity.issues.length ? `: ${item.integrity.issues.join("; ")}` : ""}</td>
            <td className="filename" title={item.recordingPath}>{item.recordingPath}</td>
          </tr>)}</tbody></table></div>}
      <p>Alert history: {report.alerts.filter(a => a.severity === "critical").length} critical,
        {report.alerts.filter(a => a.severity === "warning").length} warnings,
        {report.alerts.filter(a => !a.resolvedAt).length} uncleared.
        Incident log: {report.incidents.length} total, {report.incidents.filter(i => !!i.resolvedAt).length} closed.</p>
      <p>Contextual stress tests saved in this browser: {report.stressTests.length} (not event-verified).</p>
      <h4>Report limitations</h4><ul>{report.limitations.map(note => <li key={note}>{note}</li>)}</ul>
      <button onClick={() => download("json")}>Download event report JSON</button>{" "}
      <button onClick={() => download("csv")}>Download event report CSV</button>
    </>}
  </section>;
}

export type ArchivedEventReport = {
  generatedAt: string; nodeId: string; eventId: string; eventName: string;
  recording: { totals: { sessions: number; failures: number; warnings: number };
    cameras: Array<{ cameraId: string; ring?: string | null; sessions: number; failures: number; warnings: number }> };
  alerts: Array<{ severity: string; resolvedAt?: string }>;
  incidents: Array<{ resolvedAt?: string }>;
  qualitySnapshot?: Record<string, CameraQualitySnapshot>;
};

export const EVENT_ARCHIVE_KEY = "tournament-event-report-archive-v1";

export function isArchivedEventReport(value: unknown): value is ArchivedEventReport {
  if (!value || typeof value !== "object") return false;
  const r = value as any;
  return typeof r.generatedAt === "string" && Number.isFinite(Date.parse(r.generatedAt)) &&
    typeof r.nodeId === "string" && typeof r.eventId === "string" &&
    typeof r.eventName === "string" && !!r.recording &&
    !!r.recording.totals && ["sessions", "failures", "warnings"].every(
      key => typeof r.recording.totals[key] === "number" && Number.isFinite(r.recording.totals[key])) &&
    Array.isArray(r.recording.cameras) && Array.isArray(r.alerts) && Array.isArray(r.incidents);
}

export function TournamentReportArchive() {
  const [reports, setReports] = useState<ArchivedEventReport[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  function refresh() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(EVENT_ARCHIVE_KEY) || "[]");
      setReports(Array.isArray(raw) ? raw.filter(isArchivedEventReport).slice(0, 15) : []);
    } catch { setReports([]); setError("Could not read saved reports."); }
  }
  useEffect(() => {
    refresh();
    window.addEventListener("tournament-report-archive-updated", refresh);
    return () => window.removeEventListener("tournament-report-archive-updated", refresh);
  }, []);
  function save(next: ArchivedEventReport[]) {
    try {
      localStorage.setItem(EVENT_ARCHIVE_KEY, JSON.stringify(next.slice(0, 15)));
      setReports(next.slice(0, 15)); setError("");
    } catch { setError("Could not save report archive. Export reports to JSON for permanent storage."); }
  }
  async function importFiles(files: FileList | null) {
    if (!files) return;
    const accepted: ArchivedEventReport[] = [];
    let rejected = 0;
    for (const file of Array.from(files).slice(0, 15)) {
      try {
        if (file.size > 5_000_000) { rejected++; continue; }
        const data: unknown = JSON.parse(await file.text());
        if (isArchivedEventReport(data)) accepted.push(data); else rejected++;
      } catch { rejected++; }
    }
    if (accepted.length) {
      const merged = [...accepted, ...reports].filter((r, index, array) =>
        array.findIndex(other => other.nodeId === r.nodeId && other.eventId === r.eventId &&
          other.generatedAt === r.generatedAt) === index);
      save(merged);
    }
    if (rejected) setError(`${rejected} file(s) rejected: invalid or oversized event report JSON.`);
  }
  const picked = reports.filter(r => selected.includes(`${r.nodeId}|${r.eventId}|${r.generatedAt}`)).slice(0, 2);
  const stats = (r: ArchivedEventReport) => ({
    sessions: r.recording.totals.sessions,
    failures: r.recording.totals.failures,
    warnings: r.recording.totals.warnings,
    failureRate: r.recording.totals.sessions ? (100 * r.recording.totals.failures / r.recording.totals.sessions) : null,
    critical: r.alerts.filter(a => a?.severity === "critical").length,
    openIncidents: r.incidents.filter(i => i && !i.resolvedAt).length
  });
  const metrics: Array<{ label: string; key: keyof ReturnType<typeof stats>; suffix?: string }> = [
    { label: "Recording sessions", key: "sessions" }, { label: "Recording failures", key: "failures" },
    { label: "Recording warnings", key: "warnings" }, { label: "Failure rate", key: "failureRate", suffix: "%" },
    { label: "Critical alerts", key: "critical" }, { label: "Open incidents", key: "openIncidents" }
  ];
  // Trends use one snapshot per event and node to avoid counting the same event repeatedly.
  // The most recently generated report for an event is the representative snapshot.
  const trendReports = [...reports].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .filter((report, index, all) => all.findIndex(other =>
      other.nodeId === report.nodeId && other.eventId === report.eventId) === index)
    .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  // Camera identity is scoped to a capture node. USB device IDs may change after reconnecting.
  const cameraSeries = Array.from(new Map(trendReports.flatMap(report =>
    report.recording.cameras.map(camera => [
      `${report.nodeId}::${camera.cameraId}`,
      { key: `${report.nodeId}::${camera.cameraId}`, node: report.nodeId,
        cameraId: camera.cameraId, label: camera.ring || camera.cameraId }
    ] as const))).values()).sort((a, b) => a.key.localeCompare(b.key));
  // Operator-confirmed physical camera labels link changing Windows device IDs.
  // Mapping is node-scoped and browser-local; no serial-number inference is attempted.
  const identityStorageKey = "tournament-physical-camera-identities-v1";
  const [cameraIdentities, setCameraIdentities] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(identityStorageKey) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([key, value]) =>
        key.length <= 512 && typeof value === "string" && value.length <= 80));
    } catch { return {}; }
  });
  const [identityError, setIdentityError] = useState("");
  function updateCameraIdentity(key: string, label: string) {
    const trimmed = label.trim().slice(0, 80);
    const next = { ...cameraIdentities };
    if (trimmed) next[key] = trimmed;
    else delete next[key];
    try { localStorage.setItem(identityStorageKey, JSON.stringify(next)); setCameraIdentities(next); setIdentityError(""); }
    catch { setIdentityError("Could not save camera identities in this browser. Export your data before clearing storage."); }
  }
  const physicalCameraSeries = Array.from(new Map(cameraSeries.map(camera => {
    const identity = cameraIdentities[camera.key];
    const groupKey = identity ? `${camera.node}::physical::${identity.toLocaleLowerCase()}` : camera.key;
    return [groupKey, { ...camera, key: groupKey, label: identity || camera.label,
      linkedIds: cameraSeries.filter(candidate => candidate.node === camera.node &&
        (identity ? cameraIdentities[candidate.key]?.toLocaleLowerCase() === identity.toLocaleLowerCase() : candidate.key === camera.key))
        .map(candidate => candidate.cameraId) }] as const;
  })).values()).sort((a, b) => a.key.localeCompare(b.key));
  const [selectedCameraSeries, setSelectedCameraSeries] = useState("");
  const activeCameraSeries = physicalCameraSeries.find(camera => camera.key === selectedCameraSeries) || physicalCameraSeries[0];
  const cameraTrend = activeCameraSeries ? trendReports.filter(report => report.nodeId === activeCameraSeries.node)
    .map(report => {
      const camera = report.recording.cameras.find(item => activeCameraSeries.linkedIds.includes(item.cameraId));
      return { eventId: report.eventId, event: report.eventName || report.eventId,
        date: report.generatedAt, node: report.nodeId, cameraId: camera?.cameraId || "",
        ring: camera?.ring || "", sessions: camera?.sessions ?? 0,
        failures: camera?.failures ?? 0, warnings: camera?.warnings ?? 0,
        failureRate: camera && camera.sessions > 0 ? 100 * camera.failures / camera.sessions : null,
        present: Boolean(camera) };
    }) : [];
  const plottedCameraTrend = cameraTrend.filter(point => point.failureRate !== null);
  function exportCameraTrend(format: "json" | "csv") {
    if (!activeCameraSeries || !cameraTrend.length) return;
    const columns = ["eventId", "event", "date", "node", "cameraId", "ring", "present",
      "sessions", "failures", "warnings", "failureRate"] as const;
    const escapeCsv = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const content = format === "json" ? JSON.stringify({ generatedAt: new Date().toISOString(),
      camera: activeCameraSeries, note: "Newest report per event and node. Missing cameras and zero-session events have no failure rate. Physical labels are operator-confirmed, browser-local and may combine different hardware if misassigned.",
      events: cameraTrend }, null, 2) : "\uFEFF" + [columns.join(","),
        ...cameraTrend.map(point => columns.map(column => escapeCsv(point[column])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `camera-reliability-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const trendRows = trendReports.flatMap(report => {
    const event = { event: report.eventName || report.eventId, eventId: report.eventId,
      node: report.nodeId, snapshot: report.generatedAt };
    const summary = stats(report);
    const cameraRows = report.recording.cameras.map(camera => ({ ...event,
      scope: "camera", cameraId: camera.cameraId, ring: camera.ring || "",
      sessions: camera.sessions, failures: camera.failures, warnings: camera.warnings,
      failureRate: camera.sessions ? 100 * camera.failures / camera.sessions : null,
      criticalAlerts: null as number | null, openIncidents: null as number | null }));
    return [{ ...event, scope: "event", cameraId: "", ring: "",
      sessions: summary.sessions, failures: summary.failures, warnings: summary.warnings,
      failureRate: summary.failureRate, criticalAlerts: summary.critical,
      openIncidents: summary.openIncidents }, ...cameraRows];
  });
  function exportTrends(format: "csv" | "json") {
    if (!trendRows.length) return;
    const columns = ["event", "eventId", "node", "snapshot", "scope", "cameraId", "ring",
      "sessions", "failures", "warnings", "failureRate", "criticalAlerts", "openIncidents"] as const;
    const escapeCsv = (value: unknown) => {
      const raw = value === null || value === undefined ? "" : String(value);
      // Prefix formula-like values to prevent spreadsheet formula execution on import.
      const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const content = format === "json"
      ? JSON.stringify({ generatedAt: new Date().toISOString(),
          note: "One most-recent snapshot per event and node. Counts are not normalized for event length.",
          rows: trendRows }, null, 2)
      : "\uFEFF" + [columns.join(","), ...trendRows.map(row =>
          columns.map(column => escapeCsv(row[column])).join(","))].join("\r\n");
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tournament-reliability-trends-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Tournament report archive">
    <h3>Tournament report archive and event comparison</h3>
    <p className="muted">Generating a consolidated report saves a snapshot in this browser (up to 15).
      Select two reports to compare event-level metrics. Reports are not synchronized between computers.</p>
    <label>Import previously exported event report JSON{" "}
      <input type="file" accept=".json,application/json" multiple onChange={e => {
        void importFiles(e.target.files); e.target.value = "";
      }} />
    </label>
    {error && <p role="alert" className="camera-warning">{error}</p>}
    {reports.length === 0 ? <p>No archived reports yet. Generate a consolidated tournament report above.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Compare</th><th>Event</th><th>Node</th><th>Snapshot</th><th>Sessions</th><th>Failures</th><th>Actions</th>
      </tr></thead><tbody>{reports.map(r => {
        const id = `${r.nodeId}|${r.eventId}|${r.generatedAt}`;
        return <tr key={id}>
          <td><input type="checkbox" aria-label={`Compare ${r.eventName || r.eventId}`}
            checked={selected.includes(id)} onChange={e => setSelected(current =>
              e.target.checked ? [...current.slice(-1), id] : current.filter(item => item !== id))} /></td>
          <td>{r.eventName || r.eventId}</td><td>{r.nodeId}</td>
          <td>{new Date(r.generatedAt).toLocaleString()}</td>
          <td>{r.recording.totals.sessions}</td><td>{r.recording.totals.failures}</td>
          <td><button type="button" onClick={() => {
            if (window.confirm("Delete this saved report snapshot?")) {
              save(reports.filter(other => other !== r));
              setSelected(current => current.filter(item => item !== id));
            }
          }}>Delete</button></td>
        </tr>;
      })}</tbody></table></div>}
    {picked.length === 2 && <>
      <h4>Event comparison</h4>
      <table><thead><tr><th>Metric</th>{picked.map(r =>
        <th key={`${r.nodeId}:${r.generatedAt}`}>{r.eventName || r.eventId} ({r.nodeId})</th>)}</tr></thead>
        <tbody>{metrics.map(metric => <tr key={metric.key}><td>{metric.label}</td>
          {picked.map(r => {
            const value = stats(r)[metric.key];
            return <td key={`${r.nodeId}:${r.generatedAt}`}>
              {value === null ? "N/A" : `${metric.suffix ? value.toFixed(1) : value}${metric.suffix || ""}`}
            </td>;
          })}</tr>)}</tbody>
      </table>
      <p className="muted">Counts depend on available recording journal entries and browser-local alert/incident
        history. Different event lengths and camera counts make raw totals non-comparable. A lower
        failure rate is not proof of better hardware reliability.</p>
    </>}
    <h4>Multi-tournament reliability trends</h4>
    <p className="muted">Uses the newest saved snapshot for each event and node. Per-camera rows are
      identified by camera ID and ring label; a reassigned camera may not represent the same physical ring.
      Empty session counts have no meaningful failure percentage.</p>
    {trendReports.length ? <>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Event</th><th>Node</th><th>Snapshot</th><th>Sessions</th><th>Failures</th>
        <th>Failure rate</th><th>Warnings</th><th>Critical alerts</th>
      </tr></thead><tbody>{trendReports.map(report => {
        const values = stats(report);
        return <tr key={`${report.nodeId}:${report.eventId}:${report.generatedAt}`}>
          <td>{report.eventName || report.eventId}</td><td>{report.nodeId}</td>
          <td>{new Date(report.generatedAt).toLocaleDateString()}</td>
          <td>{values.sessions}</td><td>{values.failures}</td>
          <td>{values.failureRate === null ? "N/A" : `${values.failureRate.toFixed(1)}%`}</td>
          <td>{values.warnings}</td><td>{values.critical}</td>
        </tr>;
      })}</tbody></table></div>
      <h4>Physical camera identity associations</h4>
      <p className="muted">Assign the same unique physical label (for example, S600-A) to old and new device IDs
        only after confirming they belong to the same camera. Labels are scoped to each capture node and saved
        in this browser. Ring names are not physical identities. An incorrect association can merge unrelated histories.</p>
      {identityError && <p role="alert">{identityError}</p>}
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Capture node</th><th>Device ID</th><th>Report name</th><th>Confirmed physical label</th></tr></thead>
        <tbody>{cameraSeries.map(camera => <tr key={camera.key}>
          <td>{camera.node}</td><td style={{ overflowWrap: "anywhere", maxWidth: 250 }}>{camera.cameraId}</td>
          <td>{camera.label}</td><td><input aria-label={`Physical identity for ${camera.node} ${camera.cameraId}`}
            value={cameraIdentities[camera.key] || ""} maxLength={80}
            placeholder="Unlinked" onChange={e => updateCameraIdentity(camera.key, e.target.value)} /></td>
        </tr>)}</tbody></table></div>
      <button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(),
          identities: cameraIdentities }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href = url; link.download = "physical-camera-identities.json"; link.click(); URL.revokeObjectURL(url);
      }}>Export physical camera associations JSON</button>
      <h4>Individual camera reliability trends</h4>
      <p className="muted">Select a camera on a specific capture node to compare its recorded failure
        percentage across tournaments. Confirmed physical labels can combine re-enumerated device IDs on the same node. Missing camera entries and events with zero sessions are not
        plotted as 0%. Results depend on retained recording history, not continuous camera uptime.</p>
      {physicalCameraSeries.length ? <>
        <label>Camera and capture node{" "}
          <select value={activeCameraSeries?.key || ""}
            onChange={e => setSelectedCameraSeries(e.target.value)}>
            {physicalCameraSeries.map(camera => <option key={camera.key} value={camera.key}>
              {camera.node} / {camera.label} ({camera.linkedIds.length} device ID(s))
            </option>)}
          </select>
        </label>
        {plottedCameraTrend.length ? <>
          <svg role="img" aria-label={`Recording failure rate trend for ${activeCameraSeries?.label || "camera"}`}
            viewBox="0 0 640 220" style={{ width: "100%", maxWidth: 720, height: "auto" }}>
            {[0, 25, 50, 75, 100].map(value => <g key={value}>
              <line x1="54" y1={182 - value * 1.5} x2="626" y2={182 - value * 1.5}
                stroke="currentColor" opacity="0.18" />
              <text x="45" y={186 - value * 1.5} textAnchor="end" fontSize="11"
                fill="currentColor">{value}%</text>
            </g>)}
            {plottedCameraTrend.length > 1 && <polyline fill="none" stroke="#3689d5"
              strokeWidth="3" points={plottedCameraTrend.map((point, index) =>
                `${54 + index * 572 / (plottedCameraTrend.length - 1)},${182 - (point.failureRate ?? 0) * 1.5}`).join(" ")} />}
            {plottedCameraTrend.map((point, index) => <g key={`${point.eventId}:${point.date}`}>
              <circle cx={54 + index * 572 / Math.max(1, plottedCameraTrend.length - 1)}
                cy={182 - (point.failureRate ?? 0) * 1.5} r="5" fill="#3689d5" />
              <title>{`${point.event}: ${point.failureRate?.toFixed(1)}% (${point.failures}/${point.sessions})`}</title>
              <text x={54 + index * 572 / Math.max(1, plottedCameraTrend.length - 1)}
                y="203" textAnchor="middle" fontSize="10" fill="currentColor">{index + 1}</text>
            </g>)}
          </svg>
          <p className="muted">Chart labels 1 through {plottedCameraTrend.length} correspond to the
            chronological non-empty event rows below. A line indicates observed percentages only,
            not measurements between events.</p>
        </> : <p>No recording sessions with calculable failure rates for this camera.</p>}
        <div style={{ overflowX: "auto" }}><table><thead><tr>
          <th>Event</th><th>Ring</th><th>Sessions</th><th>Failures</th><th>Failure rate</th><th>Warnings</th>
        </tr></thead><tbody>{cameraTrend.map(point => <tr key={`${point.eventId}:${point.date}`}>
          <td>{point.event}</td><td>{point.present ? point.ring || "Unassigned" : "Not in report"}</td>
          <td>{point.present ? point.sessions : "N/A"}</td>
          <td>{point.present ? point.failures : "N/A"}</td>
          <td>{point.failureRate === null ? "N/A" : `${point.failureRate.toFixed(1)}%`}</td>
          <td>{point.present ? point.warnings : "N/A"}</td>
        </tr>)}</tbody></table></div>
        <button type="button" onClick={() => exportCameraTrend("csv")}>Export camera trend CSV</button>{" "}
        <button type="button" onClick={() => exportCameraTrend("json")}>Export camera trend JSON</button>
      </> : <p>No per-camera recording data in saved reports.</p>}
      <h4>Per-camera reliability by tournament</h4>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Event</th><th>Node</th><th>Ring</th><th>Camera ID</th><th>Sessions</th>
        <th>Failures</th><th>Failure rate</th><th>Warnings</th>
      </tr></thead><tbody>{trendRows.filter(row => row.scope === "camera").map((row, index) =>
        <tr key={`${row.node}:${row.eventId}:${row.cameraId}:${index}`}>
          <td>{row.event}</td><td>{row.node}</td><td>{row.ring || "Unassigned"}</td>
          <td>{row.cameraId}</td><td>{row.sessions}</td><td>{row.failures}</td>
          <td>{row.failureRate === null ? "N/A" : `${row.failureRate.toFixed(1)}%`}</td>
          <td>{row.warnings}</td>
        </tr>)}</tbody></table></div>
      <button type="button" onClick={() => exportTrends("csv")}>Export reliability trends CSV</button>{" "}
      <button type="button" onClick={() => exportTrends("json")}>Export reliability trends JSON</button>
    </> : <p>Save or import an event report to begin tracking trends.</p>}
    <h4>Recording quality configuration comparison</h4>
    <p className="muted">These are configured quality settings captured when each event report was generated,
      not verified historical recording settings. Only reports generated with Milestone 58 or later
      include configuration snapshots. Use the table to compare planned setups, not to attribute
      historical failures to a particular resolution, frame rate or bitrate.</p>
    {trendReports.some(report => Object.keys(report.qualitySnapshot || {}).length > 0) ?
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Event</th><th>Node</th><th>Camera ID</th><th>Configured resolution</th>
        <th>FPS</th><th>Recording bitrate</th><th>Streaming bitrate</th>
        <th>Event camera sessions</th><th>Event camera failures</th>
      </tr></thead><tbody>{trendReports.flatMap(report =>
        Object.entries(report.qualitySnapshot || {}).filter(([, quality]) => validCameraQuality(quality))
          .map(([cameraId, quality]) => {
            const historical = report.recording.cameras.find(camera => camera.cameraId === cameraId);
            return <tr key={`${report.nodeId}:${report.eventId}:${cameraId}`}>
              <td>{report.eventName || report.eventId}</td><td>{report.nodeId}</td>
              <td>{cameraId}</td><td>{quality.width}x{quality.height}</td>
              <td>{quality.fps}</td><td>{quality.recordingBitrateMbps} Mbps</td>
              <td>{quality.streamingBitrateKbps} kbps</td>
              <td>{historical?.sessions ?? "N/A"}</td><td>{historical?.failures ?? "N/A"}</td>
            </tr>;
          }))}</tbody></table></div> :
      <p>No configuration snapshots available. Generate a new consolidated event report to capture current settings.</p>}
    <button type="button" disabled={!trendReports.some(r => Object.keys(r.qualitySnapshot || {}).length)}
      onClick={() => {
        const rows = trendReports.flatMap(report =>
          Object.entries(report.qualitySnapshot || {}).filter(([, q]) => validCameraQuality(q))
            .map(([cameraId, q]) => {
              const historical = report.recording.cameras.find(c => c.cameraId === cameraId);
              return [report.eventName || report.eventId, report.nodeId, report.generatedAt, cameraId,
                q.width, q.height, q.fps, q.recordingBitrateMbps, q.streamingBitrateKbps,
                historical?.sessions ?? "", historical?.failures ?? ""];
            }));
        const safe = (v: unknown) => {
          const raw = String(v ?? "");
          const protectedValue = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
          return '"' + protectedValue.replace(/"/g, '""') + '"';
        };
        const header = ["event", "node", "snapshotAt", "cameraId", "width", "height", "fps",
          "recordingBitrateMbps", "streamingBitrateKbps", "eventCameraSessions", "eventCameraFailures"];
        const csv = "\uFEFF" + [header, ...rows].map(row => row.map(safe).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url;
        link.download = `tournament-camera-configuration-comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export camera configuration comparison CSV</button>
    <p className="muted">Trend data is based on snapshots of the available recording journal and
      browser-local incidents and alerts. It does not measure stream uptime or recording duration.
      Compare tests with similar camera counts, workloads and event lengths.</p>
  </section>;
}
