import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SystemResourceSnapshot } from "./SystemResources";

export type RecordingConfigurationReliability = {
  scannedSessions: number; unknownConfiguration: number; truncated: boolean; note: string;
  configurations: Array<{ key: string; width: number; height: number; fps: number;
    inputWidth: number; inputHeight: number; inputFps: number; inputFormat: string;
    recordingBitrateMbps: number; streamingBitrateKbps: number;
    sessions: number; completed: number; failed: number; stopped: number;
    active: number; unfinished: number; failureRatePercent: number | null }>;
};

export function RecordingConfigurationReliabilityPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<RecordingConfigurationReliability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/recording-history/configuration-reliability")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    if (!report) return;
    const header = ["width", "height", "requestedFps", "recordingBitrateMbps", "streamingBitrateKbps",
      "selectedInputWidth", "selectedInputHeight", "selectedInputFps", "inputFormat", "sessions",
      "completed", "failed", "stopped", "active", "unfinished", "failureRatePercent"];
    const rows = report.configurations.map(q => [q.width, q.height, q.fps, q.recordingBitrateMbps,
      q.streamingBitrateKbps, q.inputWidth, q.inputHeight, q.inputFps, q.inputFormat,
      q.sessions, q.completed, q.failed, q.stopped, q.active, q.unfinished, q.failureRatePercent ?? ""]);
    const csvCell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^\s*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const csv = "\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = "recording-start-configuration-reliability.csv";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Recording configuration reliability">
    <h3>Recording-start configuration reliability</h3>
    <p>Compare outcomes using the configuration saved when each recording began, rather than a later settings snapshot.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Loading..." : "Analyze recent recording sessions"}
    </button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Scanned {report.scannedSessions} sessions; {report.unknownConfiguration} have unknown or invalid
        recording-start settings.{report.truncated ? " Only the latest 200 journal sessions were scanned." : ""}</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Requested input</th><th>Selected MJPEG mode</th><th>Recording bitrate</th>
        <th>Stream bitrate</th><th>Completed</th><th>Failed</th><th>Active</th>
        <th>Unfinished</th><th>Failure rate</th>
      </tr></thead><tbody>{report.configurations.map(q => <tr key={q.key}>
        <td>{q.width}x{q.height} @ {q.fps} fps</td>
        <td>{q.inputWidth}x{q.inputHeight} @ {q.inputFps} fps ({q.inputFormat})</td>
        <td>{q.recordingBitrateMbps} Mbps</td><td>{q.streamingBitrateKbps} kbps</td>
        <td>{q.completed}</td><td>{q.failed}</td><td>{q.active}</td><td>{q.unfinished}</td>
        <td>{q.failureRatePercent === null ? "N/A" : `${q.failureRatePercent}%`}</td>
      </tr>)}</tbody></table></div>
      <p className="muted">{report.note}</p>
      <button type="button" onClick={exportCsv}>Export configuration reliability CSV</button>
    </>}
  </section>;
}

export type CameraConfigurationReliabilityReport = {
  scannedSessions: number; unknownConfiguration: number; truncated: boolean; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; configurationKey: string;
    requested: { width: number; height: number; fps: number; recordingBitrateMbps: number; streamingBitrateKbps: number };
    selectedInput: { width: number; height: number; fps: number; format: string };
    sessions: number; stopped: number; failed: number; active: number; unfinished: number;
    completed: number; failureRatePercent: number | null }>;
};

export function CameraConfigurationReliabilityPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<CameraConfigurationReliabilityReport | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/recording-history/camera-configuration-reliability")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const rows = (report?.cameras || []).filter(row => !filter || row.cameraId === filter);
  function exportCsv() {
    if (!report) return;
    const header = ["cameraId", "cameraName", "requestedWidth", "requestedHeight", "requestedFps",
      "recordingBitrateMbps", "streamingBitrateKbps", "inputWidth", "inputHeight", "inputFps",
      "inputFormat", "sessions", "completed", "stopped", "failed", "active", "unfinished", "failureRatePercent"];
    const data = rows.map(r => [r.cameraId, r.cameraName, r.requested.width, r.requested.height,
      r.requested.fps, r.requested.recordingBitrateMbps, r.requested.streamingBitrateKbps,
      r.selectedInput.width, r.selectedInput.height, r.selectedInput.fps, r.selectedInput.format,
      r.sessions, r.completed, r.stopped, r.failed, r.active, r.unfinished, r.failureRatePercent ?? ""]);
    const cell = (value: unknown) => {
      let raw = String(value ?? "");
      if (/^\s*[=+@-]/.test(raw)) raw = "'" + raw;
      return '"' + raw.replace(/"/g, '""') + '"';
    };
    const csv = "\uFEFF" + [header, ...data].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = "camera-recording-configuration-reliability.csv";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Per-camera configuration reliability">
    <h3>Per-camera recording configuration reliability</h3>
    <p>Compare recording-start configurations within each camera, separating camera-specific
      failures from patterns that appear across multiple devices.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Loading..." : "Analyze camera and configuration history"}
    </button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Scanned {report.scannedSessions} recent sessions. {report.unknownConfiguration} have
        unknown configuration.{report.truncated ? " Journal results are capped at 200 sessions." : ""}</p>
      <label>Camera filter <select value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">All cameras</option>
        {[...new Map(report.cameras.map(r => [r.cameraId, r.cameraName])).entries()]
          .map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
      </select></label>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Requested</th><th>Selected MJPEG input</th><th>Recording bitrate</th>
        <th>Sessions</th><th>Completed</th><th>Failed</th><th>Active</th><th>Unfinished</th><th>Failure rate</th>
      </tr></thead><tbody>{rows.map(r => <tr key={`${r.cameraId}:${r.configurationKey}`}>
        <td>{r.cameraName} ({r.cameraId})</td>
        <td>{r.requested.width}x{r.requested.height} @ {r.requested.fps} fps</td>
        <td>{r.selectedInput.width}x{r.selectedInput.height} @ {r.selectedInput.fps} fps ({r.selectedInput.format})</td>
        <td>{r.requested.recordingBitrateMbps} Mbps</td>
        <td>{r.sessions}</td><td>{r.completed}</td><td>{r.failed}</td>
        <td>{r.active}</td><td>{r.unfinished}</td>
        <td>{r.failureRatePercent === null ? "N/A" : `${r.failureRatePercent}%`}</td>
      </tr>)}</tbody></table></div>
      <p className="muted">{report.note}</p>
      <button type="button" onClick={exportCsv}>Export per-camera reliability CSV</button>
    </>}
  </section>;
}

export type ReliabilityWarningReport = {
  generatedAt: string; scannedSessions: number; excluded: number; evaluatedGroups: number;
  truncated: boolean; note: string;
  thresholds: { minCompleted: number; minFailed: number; minFailureRatePercent: number };
  knownIssues?: Array<{ cameraId: string; note: string; updatedAt: string }>;
  warnings: Array<{ code: string; severity: string; cameraId?: string; cameraName?: string;
    configurationKey?: string; completed: number; failed: number;
    failureRatePercent: number; message: string }>;
};

export type CameraHealthReport = {
  checkedAt: string; scannedSessions: number; truncated: boolean; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; connected: boolean;
    recordingActive: boolean; completedSessions: number; failedSessions: number;
    failureRatePercent: number | null; knownIssue: { note: string; updatedAt: string } | null;
    repeatedFailures: boolean; warnings: string[]; status: string }>;
};

export function CameraHealthPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<CameraHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/camera-health")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="session-panel" aria-label="Camera health summary">
    <h3>Camera health summary</h3>
    <p>One view of connected cameras, active recording sessions, historical failures and operator notes.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Checking cameras..." : "Refresh camera health"}
    </button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Checked {new Date(report.checkedAt).toLocaleString()}. Scanned {report.scannedSessions} sessions.
        {report.truncated ? " History is capped at 200 sessions." : ""}</p>
      {report.cameras.length === 0 ? <p>No cameras found in device discovery, recording history or operator notes.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr>
          <th>Camera</th><th>Connection</th><th>Recording</th><th>Completed</th>
          <th>Failures</th><th>Failure rate</th><th>Health</th><th>Known issue / warnings</th>
        </tr></thead><tbody>{report.cameras.map(camera => <tr key={camera.cameraId}>
          <td title={camera.cameraId}>{camera.cameraName}</td>
          <td>{camera.connected ? "Detected" : "Not detected"}</td>
          <td>{camera.recordingActive ? "Active" : "Inactive"}</td>
          <td>{camera.completedSessions}</td><td>{camera.failedSessions}</td>
          <td>{camera.failureRatePercent === null ? "N/A" : `${camera.failureRatePercent}%`}</td>
          <td>{camera.status === "no-known-problems" ? "No known problems" :
            camera.status === "untested" ? "No completed sessions" :
            camera.status === "disconnected" ? "Not connected" : "Needs attention"}</td>
          <td>{camera.knownIssue?.note ? <p><strong>Operator note:</strong> {camera.knownIssue.note}</p> : null}
            {camera.warnings.length ? <ul>{camera.warnings.map(warning =>
              <li key={warning}>{warning}</li>)}</ul> : "None"}</td>
        </tr>)}</tbody></table></div>}
      <p className="muted">{report.note}</p>
    </>}
  </section>;
}

export type CameraHealthHistoryEvent = {
  at: string; cameraId: string; cameraName: string; connected: boolean;
  recordingActive: boolean; field: "baseline" | "connection" | "recording";
  previous: boolean | null; current: boolean;
};

export type CameraHealthHistoryResponse = {
  checkedAt: string; trackedCameras: number; totalRetainedEvents: number;
  historyLimit: number; note: string; events: CameraHealthHistoryEvent[];
};

export function CameraHealthHistoryPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [history, setHistory] = useState<CameraHealthHistoryResponse | null>(null);
  const [cameraFilter, setCameraFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setHistory(await requestNode("/api/camera-health/history?limit=500")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [requestNode]);
  const cameras = [...new Map((history?.events || []).map(event =>
    [event.cameraId, event.cameraName])).entries()];
  const visible = (history?.events || []).filter(event => !cameraFilter || event.cameraId === cameraFilter);
  function exportCsv() {
    const rows = [["detectedAt", "cameraId", "cameraName", "eventType", "previous", "current", "connected", "recordingActive"],
      ...visible.map(e => [e.at, e.cameraId, e.cameraName, e.field, e.previous === null ? "" : String(e.previous),
        String(e.current), String(e.connected), String(e.recordingActive)])];
    const escape = (value: string) => {
      const safe = /^\s*[=+@-]/.test(value) ? "'" + value : value;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const csv = "\uFEFF" + rows.map(row => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `camera-health-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Camera health history">
    <h3>Camera connection and recording history</h3>
    <p>Tracks changes detected by the capture node every 30 seconds. Data survives browser
      restarts and is shared by dashboards connected to the same node.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Checking history..." : "Refresh health history"}
    </button>
    {error && <p role="alert">{error}</p>}
    {history && <>
      <p>{history.trackedCameras} tracked camera IDs, {history.totalRetainedEvents} retained events
        (maximum {history.historyLimit}).</p>
      <label>Camera <select value={cameraFilter} onChange={e => setCameraFilter(e.target.value)}>
        <option value="">All cameras</option>
        {cameras.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <button type="button" disabled={!visible.length} onClick={exportCsv}>Export displayed history CSV</button>
      {visible.length === 0 ? <p>No recorded changes for this selection.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr>
          <th>Detected at</th><th>Camera</th><th>Change</th><th>Previous</th><th>Current</th>
        </tr></thead><tbody>{visible.map((event, index) => <tr key={`${event.at}:${event.cameraId}:${event.field}:${index}`}>
          <td>{new Date(event.at).toLocaleString()}</td><td title={event.cameraId}>{event.cameraName}</td>
          <td>{event.field === "baseline" ? "First observed" :
            event.field === "connection" ? "Windows device availability" : "Recording activity"}</td>
          <td>{event.previous === null ? "Unknown" : event.previous ? "Yes" : "No"}</td>
          <td>{event.current ? "Yes" : "No"}</td>
        </tr>)}</tbody></table></div>}
      <p className="muted">{history.note} Device IDs may change after USB re-enumeration.
        Recording activity reflects the managed capture process, not verified file integrity.</p>
    </>}
  </section>;
}

export type DisconnectionSummary = {
  checkedAt: string; retainedEvents: number; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; disconnects: number;
    reconnects: number; completedOutages: number; observedDowntimeMs: number;
    longestCompletedOutageMs: number; currentlyDisconnected: boolean;
    openOutageSince: string | null; firstObservedAt: string | null }>;
};

export function CameraDisconnectionAnalysis({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<DisconnectionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/camera-health/disconnections")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [requestNode]);
  function exportCsv() {
    if (!report) return;
    const rows: Array<Array<string | number>> = [
      ["cameraId", "cameraName", "disconnects", "reconnects", "completedOutages",
        "observedDowntimeSeconds", "longestCompletedOutageSeconds", "currentlyDisconnected", "openOutageSince"],
      ...report.cameras.map(c => [c.cameraId, c.cameraName, c.disconnects, c.reconnects,
        c.completedOutages, Math.round(c.observedDowntimeMs / 1000),
        Math.round(c.longestCompletedOutageMs / 1000), String(c.currentlyDisconnected), c.openOutageSince || ""])
    ];
    const safe = (value: string | number) => {
      const raw = String(value);
      const escaped = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
      return '"' + escaped.replace(/"/g, '""') + '"';
    };
    const csv = "\uFEFF" + rows.map(row => row.map(safe).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `camera-disconnections-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Camera disconnection analysis">
    <h3>Camera USB disconnections and observed downtime</h3>
    <p>Summarizes connection changes captured by the node's 30-second health sampling.
      Repeated disconnections may indicate a camera, cable, hub, power, or USB controller issue.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Analyzing..." : "Analyze disconnections"}
    </button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>{report.cameras.length} tracked camera IDs, {report.retainedEvents} retained events.</p>
      <button type="button" disabled={!report.cameras.length} onClick={exportCsv}>Export disconnection analysis CSV</button>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Disconnects</th><th>Reconnects</th><th>Completed outages</th>
        <th>Observed downtime</th><th>Longest completed outage</th><th>Current status</th>
      </tr></thead><tbody>{report.cameras.map(c => <tr key={c.cameraId}>
        <td title={c.cameraId}>{c.cameraName}</td><td>{c.disconnects}</td>
        <td>{c.reconnects}</td><td>{c.completedOutages}</td>
        <td>{Math.round(c.observedDowntimeMs / 1000)} seconds</td>
        <td>{Math.round(c.longestCompletedOutageMs / 1000)} seconds</td>
        <td>{c.currentlyDisconnected ? `Disconnected${c.openOutageSince ? ` since ${new Date(c.openOutageSince).toLocaleString()}` : " (start unknown)"}` : "Connected"}</td>
      </tr>)}</tbody></table></div>
      <p className="muted">{report.note}</p>
    </>}
  </section>;
}

export type UsbRecordingCorrelationReport = {
  checkedAt: string; windowSeconds: number; observedDisconnects: number; sessionsAnalyzed: number;
  cameras: Array<{ cameraId: string; cameraName: string; completed: number; failed: number;
    sessionsWithDisconnect: number; failedWithDisconnect: number; failedWithoutDisconnect: number; unknownIntervals: number }>;
  sessions: Array<{ cameraId: string; cameraName: string; startedAt: string; outcome: string;
    matchingDisconnects: number; disconnectTimes: string[] }>;
  limitations: string[];
};

export function UsbRecordingCorrelationPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<UsbRecordingCorrelationReport | null>(null);
  const [seconds, setSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyze() {
    setBusy(true); setError("");
    try { setReport(await requestNode(`/api/camera-health/recording-correlation?windowSeconds=${seconds}`)); }
    catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  return <section className="session-panel" aria-label="USB disconnection and recording failure correlation">
    <h3>USB disconnect / recording failure correlation</h3>
    <p>Compare observed camera disconnections with completed recording session intervals.
      A match is a timing coincidence, not proof of the cause of failure.</p>
    <label>Correlation margin (seconds) <input type="number" min={0} max={600} step={30}
      value={seconds} onChange={event => setSeconds(Math.min(600, Math.max(0, Number(event.target.value) || 0)))} /></label>{" "}
    <button type="button" disabled={busy} onClick={() => void analyze()}>
      {busy ? "Analyzing..." : "Analyze USB and recording history"}</button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Analyzed {report.sessionsAnalyzed} completed recording sessions and {report.observedDisconnects}
        observed disconnect transitions. Margin: {report.windowSeconds} seconds.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Completed</th>
        <th>Failures</th><th>Sessions near disconnect</th><th>Failures near disconnect</th>
        <th>Failures without nearby disconnect</th><th>Unknown intervals</th></tr></thead>
        <tbody>{report.cameras.map(camera => <tr key={camera.cameraId}>
          <td>{camera.cameraName}</td><td>{camera.completed}</td><td>{camera.failed}</td>
          <td>{camera.sessionsWithDisconnect}</td><td>{camera.failedWithDisconnect}</td>
          <td>{camera.failedWithoutDisconnect}</td><td>{camera.unknownIntervals}</td>
        </tr>)}</tbody></table></div>
      <h4>Failed or temporally matched sessions</h4>
      {report.sessions.length === 0 ? <p>No matching sessions in the retained history.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Started</th>
          <th>Outcome</th><th>Nearby disconnections</th></tr></thead><tbody>
          {report.sessions.map((session, index) => <tr key={`${session.cameraId}:${session.startedAt}:${index}`}>
            <td>{session.cameraName}</td><td>{session.startedAt}</td><td>{session.outcome}</td>
            <td>{session.matchingDisconnects}</td></tr>)}</tbody></table></div>}
      <p className="muted">{report.limitations.join(" ")}</p>
    </>}
  </section>;
}

export type DiagnosticThresholds = {
  cpuPercent: number; gpuPercent: number; ramPercent: number;
  diskWriteMiBps: number; minimumUsbDisconnects: number;
};

export type FailureInvestigationReport = {
  generatedAt: string; windowSeconds: number; failedSessions: number;
  withNearbyDisconnect: number; withResourceSamples: number;
  diagnosticThresholds?: DiagnosticThresholds; sessionsWithDiagnosticWarnings?: number;
  recommendations?: Array<{ id: string; priority: "high" | "medium" | "info";
    title: string; affectedSessions: number; cameras: string[]; evidence: string; nextSteps: string[] }>;
  sessions: Array<{ cameraId: string; cameraName: string; recordingPath: string;
    diagnosticWarnings?: string[];
    failedAt: string | null; observedUsbDisconnects: number; usbIntervalKnown: boolean;
    resourceSamples: number; closestResourceReading: null | { at: string; cpuPercent: number | null;
      gpuPercent: number | null; diskWriteMiBps: number | null };
    peakNearbyResources: null | { cpuPercent: number | null; gpuPercent: number | null;
      diskWriteMiBps: number | null }; evidence: { usb: string; resources: string } }>;
  limitations: string[];
};

export type CameraReliabilitySummary = {
  generatedAt: string;
  totals: { cameras: number; recordings: number; failedRecordings: number; usbDisconnects: number };
  cameras: Array<{ cameraId: string; cameraName: string; recordings: number; completed: number;
    failures: number; activeOrUnknown: number; usbDisconnects: number; usbReconnects: number;
    lastFailureAt: string | null; lastDisconnectAt: string | null }>;
  limitations: string[];
};

export function CameraReliabilityDashboard({ requestNode }: { requestNode: (url: string, options?: RequestInit) => Promise<any> }) {
  const [report, setReport] = useState<CameraReliabilitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try { setReport(await requestNode("/api/camera-health/reliability-summary")); }
    catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `camera-reliability-${report.generatedAt.slice(0, 10)}.json`;
    link.click(); URL.revokeObjectURL(url);
  }
  return <fieldset><legend>Camera reliability overview</legend>
    <p>Compare observed recording failures and USB interruptions across cameras on this capture node.</p>
    <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Loading…" : "Refresh reliability"}</button>{" "}
    <button type="button" onClick={download} disabled={!report}>Export JSON</button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Last checked: {new Date(report.generatedAt).toLocaleString()} | Cameras: {report.totals.cameras} | Recent recordings: {report.totals.recordings} | Failed: {report.totals.failedRecordings} | Observed USB disconnects: {report.totals.usbDisconnects}</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Recordings</th><th>Completed</th><th>Failed</th><th>Active / unknown</th><th>USB disconnects</th><th>Reconnects</th><th>Last failure</th></tr></thead>
      <tbody>{report.cameras.map(camera => <tr key={camera.cameraId}><td>{camera.cameraName}</td><td>{camera.recordings}</td><td>{camera.completed}</td><td>{camera.failures}</td><td>{camera.activeOrUnknown}</td><td>{camera.usbDisconnects}</td><td>{camera.usbReconnects}</td><td>{camera.lastFailureAt ? new Date(camera.lastFailureAt).toLocaleString() : "None observed"}</td></tr>)}</tbody></table></div>
      {report.cameras.length === 0 && <p>No recording or USB history has been collected yet.</p>}
      <small>{report.limitations.join(" ")}</small>
    </>}
  </fieldset>;
}

export function FailureInvestigationPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<FailureInvestigationReport | null>(null);
  const [windowSeconds, setWindowSeconds] = useState(120);
  const [thresholds, setThresholds] = useState<DiagnosticThresholds | null>(null);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [thresholdNotice, setThresholdNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    void requestNode("/api/camera-health/diagnostic-thresholds")
      .then(value => { if (mounted) setThresholds(value); })
      .catch(() => { if (mounted) setThresholdNotice("Could not load diagnostic thresholds."); });
    return () => { mounted = false; };
  }, [requestNode]);
  async function saveThresholds() {
    if (!thresholds) return;
    setSavingThresholds(true); setThresholdNotice("");
    try {
      const saved = await requestNode("/api/camera-health/diagnostic-thresholds", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds)
      });
      setThresholds(saved); setThresholdNotice("Diagnostic thresholds saved on capture node. Re-run analysis.");
    } catch (cause) { setThresholdNotice(String(cause)); }
    finally { setSavingThresholds(false); }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyze() {
    setBusy(true); setError("");
    try { setReport(await requestNode(`/api/camera-health/failure-investigation?windowSeconds=${windowSeconds}`)); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function exportJson() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `camera-failure-investigation-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const fmt = (value: number | null | undefined, unit = "%") =>
    typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "No data";
  return <section className="session-panel" aria-label="Combined recording failure investigation">
    <h3>Combined recording failure investigation</h3>
    <p>Compare observed USB disconnections and historical system resource samples for each failed
      recording. Missing data is marked unknown. Neither correlation establishes the cause.</p>
    <fieldset disabled={savingThresholds}>
      <legend>Diagnostic warning thresholds (capture-node settings)</legend>
      {thresholds ? <>
        {([ ["cpuPercent", "CPU %", 1, 100], ["gpuPercent", "GPU %", 1, 100],
          ["ramPercent", "RAM %", 1, 100], ["diskWriteMiBps", "Disk writes MiB/s", 1, 100000],
          ["minimumUsbDisconnects", "Nearby USB disconnects", 1, 100]
        ] as const).map(([key, label, min, max]) =>
          <label key={key}>{label}{" "}<input type="number" min={min} max={max}
            step={key === "minimumUsbDisconnects" ? 1 : "any"} value={thresholds[key]}
            onChange={event => setThresholds(current => current ?
              { ...current, [key]: Number(event.target.value) } : current)} /></label>)}
        <button type="button" disabled={savingThresholds} onClick={() => void saveThresholds()}>
          {savingThresholds ? "Saving..." : "Save diagnostic thresholds"}</button>
      </> : <p>Thresholds unavailable.</p>}
      {thresholdNotice && <p role="status">{thresholdNotice}</p>}
    </fieldset>
    <label>Timestamp margin (seconds) <input type="number" min={0} max={600} step={15}
      value={windowSeconds} onChange={e => setWindowSeconds(Math.min(600, Math.max(0, Number(e.target.value) || 0)))} /></label>{" "}
    <button type="button" disabled={busy} onClick={() => void analyze()}>
      {busy ? "Analyzing..." : "Investigate recording failures"}</button>{" "}
    {report && <button type="button" onClick={exportJson}>Export investigation JSON</button>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>{report.failedSessions} failed sessions, {report.withNearbyDisconnect} with nearby observed USB
        disconnections, {report.withResourceSamples} with matching resource samples.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Failure time</th><th>USB disconnects</th><th>Resource samples</th>
        <th>Peak CPU</th><th>Peak GPU</th><th>Peak disk write</th><th>Evidence</th><th>Diagnostic warnings</th>
      </tr></thead><tbody>{report.sessions.map((row, i) => <tr key={`${row.cameraId}:${row.recordingPath}:${i}`}>
        <td>{row.cameraName || row.cameraId}</td><td>{row.failedAt ? new Date(row.failedAt).toLocaleString() : "Unknown"}</td>
        <td>{row.usbIntervalKnown ? row.observedUsbDisconnects : "Unknown"}</td>
        <td>{row.resourceSamples}</td><td>{fmt(row.peakNearbyResources?.cpuPercent)}</td>
        <td>{fmt(row.peakNearbyResources?.gpuPercent)}</td>
        <td>{fmt(row.peakNearbyResources?.diskWriteMiBps, " MiB/s")}</td>
        <td>{row.evidence.usb}; {row.evidence.resources}</td>
        <td>{row.diagnosticWarnings?.length ? row.diagnosticWarnings.join("; ") : "None flagged (or insufficient data)"}</td>
      </tr>)}</tbody></table></div>
      <h4>Prioritized troubleshooting recommendations</h4>
      <p className="muted">Suggestions are derived from configurable thresholds and timestamped
        observations. They are not automatic diagnoses. Multiple recommendations may apply to the same failure.</p>
      {!report.recommendations?.length ? <p>No threshold-based recommendations from available evidence.
        This does not establish that recordings are healthy.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Priority</th>
          <th>Investigation</th><th>Affected failures</th><th>Cameras</th><th>Evidence and next steps</th>
        </tr></thead><tbody>{report.recommendations.map(item => <tr key={item.id}>
          <td>{item.priority}</td><td>{item.title}</td><td>{item.affectedSessions}</td>
          <td>{item.cameras.join(", ") || "Unknown"}</td>
          <td>{item.evidence}<ul>{item.nextSteps.map(step => <li key={step}>{step}</li>)}</ul></td>
        </tr>)}</tbody></table></div>}
      <p className="muted">{report.limitations.join(" ")}</p>
    </>}
  </section>;
}

export type ResourceFailureCorrelation = {
  generatedAt: string; windowSeconds: number; failedSessions: number;
  failuresWithSamples: number; resourceSamplesConsidered: number;
  sessions: Array<{ cameraId: string; cameraName: string; recordingPath: string;
    failedAt: string | null; nearbySamples: number; inRetention: boolean;
    closest: null | { at: string; offsetSeconds: number; cpuPercent: number | null;
      gpuPercent: number | null; ramUsedGiB: number | null; diskWriteMiBps: number | null };
    maximumNearby: { cpuPercent: number | null; gpuPercent: number | null;
      ramUsedGiB: number | null; diskWriteMiBps: number | null } }>;
  limitations: string[];
};

export type CameraTroubleshootingReport = {
  generatedAt: string;
  correlation: UsbRecordingCorrelationReport;
  disconnections: { cameras?: Array<{ cameraId: string; cameraName: string;
    disconnects?: number; completedOutages?: number; totalObservedDowntimeSeconds?: number }> };
  resources: SystemResourceSnapshot;
  limitations: string[];
};

export type TimestampedResourceHistory = { readings: Array<SystemResourceSnapshot & { activeCameraIds: string[] }>;
  sampling: { intervalSeconds: number; lastSampleAt: string | null; lastError: string | null }; notes: string[] };

export function CameraTroubleshootingPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<CameraTroubleshootingReport | null>(null);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [resourceHistory, setResourceHistory] = useState<TimestampedResourceHistory | null>(null);
  const [failureCorrelation, setFailureCorrelation] = useState<ResourceFailureCorrelation | null>(null);
  const [resourceWindowSeconds, setResourceWindowSeconds] = useState(120);
  const [historyHours, setHistoryHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true); setError("");
    try { setReport(await requestNode(`/api/camera-health/troubleshooting-report?windowSeconds=${windowSeconds}`)); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function loadResourceHistory() {
    setBusy(true); setError("");
    try {
      const end = new Date();
      const start = new Date(end.getTime() - historyHours * 3600000);
      setResourceHistory(await requestNode(`/api/system/resources/history?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&limit=2000`));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function analyzeHistoricalFailures() {
    setBusy(true); setError("");
    try { setFailureCorrelation(await requestNode(
      `/api/camera-health/resource-failure-correlation?windowSeconds=${resourceWindowSeconds}`)); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  function downloadHistoricalFailures() {
    if (!failureCorrelation) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(failureCorrelation, null, 2)],
      { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `resource-failure-correlation-${failureCorrelation.generatedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `camera-troubleshooting-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const format = (n: number | null | undefined, suffix = "%") =>
    typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}${suffix}` : "Unavailable";
  return <section className="session-panel" aria-label="Unified camera troubleshooting report">
    <h3>Unified camera troubleshooting report</h3>
    <p>Combine recent recording outcomes, observed USB disconnections, and a current system resource
      snapshot. Resource readings are not historical measurements from the time of a failure.</p>
    <label>Disconnect correlation margin (seconds) <input type="number" min={0} max={600} step={30}
      value={windowSeconds} onChange={e => setWindowSeconds(Math.min(600, Math.max(0, Number(e.target.value) || 0)))} /></label>{" "}
    <button type="button" disabled={busy} onClick={() => void generate()}>
      {busy ? "Generating..." : "Generate troubleshooting report"}</button>{" "}
    {report && <button type="button" onClick={download}>Download troubleshooting JSON</button>}
    {error && <p role="alert">{error}</p>}
    <h4>Historical recording failure and resource correlation</h4>
    <p>Compare failed recording end times with system readings captured while that camera was recording.
      A nearby high reading is not proof that it caused the failure.</p>
    <label>Resource matching margin (seconds) <input type="number" min={0} max={600} step={15}
      value={resourceWindowSeconds} onChange={e => setResourceWindowSeconds(
        Math.min(600, Math.max(0, Number(e.target.value) || 0)))} /></label>{" "}
    <button type="button" disabled={busy} onClick={() => void analyzeHistoricalFailures()}>
      Analyze historical resource readings</button>{" "}
    {failureCorrelation && <button type="button" onClick={downloadHistoricalFailures}>Export correlation JSON</button>}
    {failureCorrelation && <>
      <p>{failureCorrelation.failuresWithSamples} of {failureCorrelation.failedSessions} failed sessions
        had at least one nearby reading. {failureCorrelation.resourceSamplesConsidered} retained samples examined.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Failure time</th>
        <th>Nearby samples</th><th>Closest offset</th><th>Peak CPU</th><th>Peak GPU</th>
        <th>Peak RAM</th><th>Peak disk write</th></tr></thead><tbody>
        {failureCorrelation.sessions.map(session => <tr key={session.recordingPath}>
          <td>{session.cameraName}</td>
          <td>{session.failedAt ? new Date(session.failedAt).toLocaleString() : "Unknown"}</td>
          <td>{session.nearbySamples}</td>
          <td>{session.closest ? `${session.closest.offsetSeconds}s` : "No data"}</td>
          <td>{format(session.maximumNearby.cpuPercent)}</td>
          <td>{format(session.maximumNearby.gpuPercent)}</td>
          <td>{format(session.maximumNearby.ramUsedGiB, " GiB")}</td>
          <td>{format(session.maximumNearby.diskWriteMiBps, " MiB/s")}</td>
        </tr>)}</tbody></table></div>
      <p className="muted">{failureCorrelation.limitations.join(" ")}</p>
    </>}
    {report && <>
      <p>Snapshot: {new Date(report.generatedAt).toLocaleString()}. Analyzed {report.correlation.sessionsAnalyzed}
        completed recording sessions and {report.correlation.observedDisconnects} observed disconnections.</p>
      <h4>Camera recording and USB correlation</h4>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Camera</th><th>Sessions</th>
        <th>Failed</th><th>Failures near disconnects</th><th>Failures without nearby disconnects</th>
        <th>Unknown intervals</th></tr></thead><tbody>
        {report.correlation.cameras.map(camera => <tr key={camera.cameraId}>
          <td>{camera.cameraName}</td><td>{camera.completed}</td><td>{camera.failed}</td>
          <td>{camera.failedWithDisconnect}</td><td>{camera.failedWithoutDisconnect}</td>
          <td>{camera.unknownIntervals}</td>
        </tr>)}</tbody></table></div>
      <h4>System resource snapshot (current, not historical)</h4>
      <table><tbody>
        <tr><th>CPU</th><td>{format(report.resources.cpu?.utilizationPercent)}</td></tr>
        <tr><th>RAM used</th><td>{format(report.resources.memory?.usedBytes != null ? report.resources.memory.usedBytes / 1073741824 : null, " GiB")}</td></tr>
        <tr><th>NVIDIA GPU</th><td>{format(report.resources.gpu?.utilizationPercent)}</td></tr>
        <tr><th>Disk write</th><td>{format(report.resources.disk?.writeBytesPerSec != null ? report.resources.disk.writeBytesPerSec / 1048576 : null, " MiB/s")}</td></tr>
      </tbody></table>
      <p className="muted">{report.limitations.join(" ")}</p>
    </>}
  </section>;
}

export type UsbReliabilityThresholds = {
  minimumDisconnects: number; minimumCompletedOutages: number;
  maximumObservedDowntimeSeconds: number; maximumSingleOutageSeconds: number;
};

export type UsbReliabilityReport = {
  checkedAt: string; trackedCameras: number; retainedEvents: number; note: string;
  thresholds: UsbReliabilityThresholds;
  warnings: Array<{ cameraId: string; cameraName: string; severity: "critical" | "warning";
    reasons: string[]; currentlyDisconnected: boolean }>;
};

export function UsbReliabilityWarningsPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<UsbReliabilityReport | null>(null);
  const [thresholds, setThresholds] = useState<UsbReliabilityThresholds | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try {
      const [next, settings] = await Promise.all([
        requestNode("/api/camera-health/usb-warnings"),
        requestNode("/api/camera-health/usb-warning-thresholds")
      ]);
      setReport(next); setThresholds(settings);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [requestNode]);
  async function save() {
    if (!thresholds) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await requestNode("/api/camera-health/usb-warning-thresholds", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(thresholds)
      });
      setNotice("USB reliability thresholds saved on capture node.");
      const updated = await requestNode("/api/camera-health/usb-warnings");
      setReport(updated);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const fields: Array<{ key: keyof UsbReliabilityThresholds; label: string }> = [
    { key: "minimumDisconnects", label: "Warn at disconnect count" },
    { key: "minimumCompletedOutages", label: "Warn at completed outage count" },
    { key: "maximumObservedDowntimeSeconds", label: "Warn at total observed downtime (seconds)" },
    { key: "maximumSingleOutageSeconds", label: "Warn at longest completed outage (seconds)" }
  ];
  return <section className="session-panel" aria-label="USB connection reliability warnings">
    <h3>USB connection reliability warnings</h3>
    <p>Flags recurring disconnections, excessive observed downtime, or currently disconnected cameras.
      These are diagnostic warnings, not proof of USB controller overload.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Checking..." : "Check USB connection warnings"}
    </button>
    {thresholds && <fieldset disabled={busy}><legend>Node-wide warning thresholds</legend>
      {fields.map(({ key, label }) => <label key={key} style={{ display: "block", margin: "0.5rem 0" }}>
        {label}{" "}<input type="number" min={1} max={key.includes("Seconds") ? 86400 : 1000}
          step={1} value={thresholds[key]}
          onChange={e => setThresholds(previous => previous ?
            { ...previous, [key]: Number(e.target.value) } : previous)} />
      </label>)}
      <button type="button" onClick={() => void save()}>Save warning thresholds</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {report && <>
      <p>{report.warnings.length} flagged camera IDs out of {report.trackedCameras} tracked;
        {" "}{report.retainedEvents} retained health events.</p>
      {report.warnings.length ? <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Severity</th><th>Reasons</th>
      </tr></thead><tbody>{report.warnings.map(w => <tr key={w.cameraId}>
        <td title={w.cameraId}>{w.cameraName}</td><td>{w.severity}</td>
        <td>{w.reasons.join("; ")}</td>
      </tr>)}</tbody></table></div> : <p>No warnings under the current thresholds.</p>}
      <p className="muted">{report.note}</p>
    </>}
  </section>;
}

export function ReliabilityWarningsPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [report, setReport] = useState<ReliabilityWarningReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thresholds, setThresholds] = useState({ minCompleted: 5, minFailed: 2, minFailureRatePercent: 20 });
  const [knownIssues, setKnownIssues] = useState<Array<{ cameraId: string; note: string; updatedAt: string }>>([]);
  const [issueCamera, setIssueCamera] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [saving, setSaving] = useState(false);
  async function loadSettings() {
    try {
      const settings = await requestNode("/api/reliability-monitor/settings");
      setThresholds(settings.thresholds); setKnownIssues(settings.issues);
    } catch (cause) { setError(String(cause)); }
  }
  useEffect(() => { void loadSettings(); }, [requestNode]);
  async function saveThresholds() {
    setSaving(true); setError("");
    try {
      const result = await requestNode("/api/reliability-monitor/thresholds", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(thresholds)
      });
      setThresholds(result.thresholds); await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }
  async function updateIssue(cameraId: string, note?: string) {
    setSaving(true); setError("");
    try {
      const result = await requestNode(`/api/reliability-monitor/issues/${encodeURIComponent(cameraId)}`, {
        method: note === undefined ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(note === undefined ? {} : { body: JSON.stringify({ note }) })
      });
      setKnownIssues(result.issues); setIssueCamera(""); setIssueNote("");
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/recording-history/reliability-warnings")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="session-panel" aria-label="Recurring recording reliability warnings">
    <h3>Recurring camera failure warnings</h3>
    <p>Review repeated recording failures by camera and recording-start configuration.
      Analysis is read-only and uses the most recent 200 journal sessions.</p>
    <fieldset disabled={saving}>
      <legend>Reliability warning thresholds (saved on this capture node)</legend>
      <label>Minimum completed sessions <input type="number" min={1} max={200} step={1}
        value={thresholds.minCompleted} onChange={e => setThresholds(p => ({ ...p, minCompleted: Number(e.target.value) }))} /></label>
      <label>Minimum failed sessions <input type="number" min={1} max={200} step={1}
        value={thresholds.minFailed} onChange={e => setThresholds(p => ({ ...p, minFailed: Number(e.target.value) }))} /></label>
      <label>Minimum failure rate (%) <input type="number" min={1} max={100} step={1}
        value={thresholds.minFailureRatePercent} onChange={e => setThresholds(p => ({ ...p, minFailureRatePercent: Number(e.target.value) }))} /></label>
      <button type="button" onClick={() => void saveThresholds()}>Save thresholds</button>
    </fieldset>
    <fieldset disabled={saving}>
      <legend>Known camera issues (operator notes)</legend>
      <label>Camera ID <input value={issueCamera} maxLength={300} onChange={e => setIssueCamera(e.target.value)} /></label>
      <label>Issue note <textarea value={issueNote} maxLength={2000} onChange={e => setIssueNote(e.target.value)} /></label>
      <button type="button" disabled={!issueCamera.trim() || !issueNote.trim()}
        onClick={() => void updateIssue(issueCamera.trim(), issueNote.trim())}>Save camera note</button>
      {knownIssues.length ? <ul>{knownIssues.map(issue => <li key={issue.cameraId}>
        <strong>{issue.cameraId}</strong>: {issue.note} ({new Date(issue.updatedAt).toLocaleString()}){" "}
        <button type="button" onClick={() => void updateIssue(issue.cameraId)}>Remove note</button>
      </li>)}</ul> : <p>No known camera issues recorded.</p>}
      <p>Notes are advisory, persist on this node, and do not suppress reliability warnings.</p>
    </fieldset>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Analyzing..." : "Analyze recurring failures"}
    </button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>Scanned {report.scannedSessions} sessions; evaluated {report.evaluatedGroups} camera/configuration
        groups. Excluded {report.excluded} active, unfinished, legacy or invalid sessions.
        {report.truncated ? " Results may be incomplete because history is capped at 200." : ""}</p>
      <p>Warning threshold: at least {report.thresholds.minCompleted} completed sessions,
        {report.thresholds.minFailed} failures and {report.thresholds.minFailureRatePercent}% failure rate.</p>
      {report.warnings.length === 0 ? <p>No recurring failure patterns met the threshold.
        This is not a guarantee that all cameras are reliable.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr>
          <th>Type</th><th>Camera</th><th>Completed</th><th>Failures</th><th>Failure rate</th><th>Guidance</th>
        </tr></thead><tbody>{report.warnings.map((warning, index) =>
          <tr key={`${warning.code}:${warning.cameraId || "shared"}:${index}`}>
            <td>{warning.code === "SHARED_CONFIGURATION_FAILURES" ? "Shared configuration" : "Camera configuration"}</td>
            <td>{warning.cameraName || "Multiple cameras"}</td><td>{warning.completed}</td>
            <td>{warning.failed}</td><td>{warning.failureRatePercent}%</td><td>{warning.message}</td>
          </tr>)}</tbody></table></div>}
      <p className="muted">{report.note}</p>
    </>}
  </section>;
}
