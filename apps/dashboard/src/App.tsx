import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

interface MediaDevice {
  kind: "video" | "audio";
  name: string;
  id: string;
  displayName?: string;
  hidden?: boolean;
}
interface DeviceList {
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  allDevices?: MediaDevice[];
}
interface DevicePreference { alias?: string; hidden?: boolean; pairedMicrophoneId?: string }
interface NetworkStatus { local: { available: boolean; address: string }; remote: { state: "disabled" | "listening" | "unavailable" | "starting"; address: string | null; message: string } }
interface AppSettings { version: 1; network: { mode: "offline" | "tailscale" | "lan"; bindAddress: string }; devices: Record<string, DevicePreference> }

interface CaptureQuality {
  inputWidth: number; inputHeight: number; inputFps: number;
  recordingFps: number; recordingBitrate: string;
  streamingWidth: number; streamingHeight: number;
  streamingFps: number; streamingBitrate: string; previewFps: number;
}
interface Capture {
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  recordingPath: string;
  selectedMode?: { width: number; height: number; fps: number } | null;
  running: boolean;
  previewAvailable: boolean;
  startedAt: string;
  frameCount: number;
  frameAgeMs: number | null;
  previewFrozen: boolean;
  recordingFileSize: number | null;
  segmentCount?: number;
  activeSegment?: string | null;
  recordingSegments?: Array<{ path: string; bytes: number; modifiedAt: string }>;
}
interface Preview {
  cameraId: string;
  status: "starting" | "running" | "stopped" | "error";
  source: "recording" | "standalone";
  previewAvailable: boolean;
  frameCount: number;
  frameAgeMs: number | null;
  previewFrozen: boolean;
}
interface PreflightResult { source?: "saved" | "draft"; ready: boolean; checks: { level: "ok" | "warning" | "error"; message: string }[]; checkedAt: string }

interface EncoderStatsSnapshot {
  checkedAt: number;
  captures: Array<{ cameraId: string; cameraName: string; startedAt: string;
    running: boolean; encoder: null | { updatedAt: number; ageMs: number;
      frame: number | null; fps: number | null; speed: number | null;
      droppedFrames: number | null; bitrateKbps: number | null; outTimeMs: number | null } }>;
}
interface StressSnapshot {
  checkedAt: number;
  captures: Array<{ cameraId: string; cameraName: string; startedAt: string;
    running: boolean; frameCount: number; frameAgeMs: number | null;
    recordingBytes: number | null; segmentCount: number }>;
}
interface StressResourceReport {
  readings: SystemResourceSnapshot[];
  failures: number;
  startedAt: string;
  endedAt: string;
}
interface StressResult {
  cameraId: string; cameraName: string; sampleCount: number;
  observedFps: number; growthBytes: number | null;
  staleSamples: number; missingSamples: number; restarted: boolean;
  status: "pass" | "warning" | "failed";
}
interface EquipmentTestResult {
  cameraId: string;
  microphoneName: string;
  checkedAt: string;
  video: { status: string; frameAgeMs: number | null; message: string };
  audio: { status: string; meanDb: number | null; maxDb: number | null; message: string };
}
interface TournamentReadiness {
  checkedAt: string;
  preflight: PreflightResult;
  storage: StorageHealth | null;
  storageError: string | null;
  rings: Array<{ ring: string; camera: string; cameraConnected: boolean; microphoneConnected: boolean;
    recording: boolean; recordingHealthy: boolean | null; youtubeLive: boolean; issues: string[] }>;
  blockers: string[];
  warnings: string[];
}
interface StorageHealth {
  status: "healthy" | "warning" | "critical" | "unknown";
  freeBytes: number;
  totalBytes: number;
  checkedAt: string;
  recordingDirectory: string;
  thresholdsGiB: { warning: number; critical: number };
}
interface CaptureHealth {
  cameraId: string;
  cameraName: string;
  status: "starting" | "healthy" | "warning";
  warnings: string[];
  recordingFileSize: number | null;
  frameAgeMs: number | null;
  fileGrowthAgeMs: number;
}

interface RecordingSummary {
  generatedAt: string;
  scannedSessions: number;
  truncated: boolean;
  ringLabelsAreCurrent: boolean;
  events: Array<{eventId: string; eventName: string}>;
  selectedEventId: string | null;
  unattributedSessions: number;
  cameras: Array<{ cameraId: string; cameraName: string; ring: string | null;
    sessions: number; active: number; failures: number; warnings: number;
    segments: number; bytes: number; knownDurationSeconds: number; unknownDurationSessions: number }>;
  totals: { sessions: number; active: number; failures: number; warnings: number;
    segments: number; bytes: number; knownDurationSeconds: number; unknownDurationSessions: number };
}
interface RecordingEvent {
  timestamp: string;
  type: "recording_started" | "recording_stopped" | "recording_failed";
  cameraId: string;
  detail?: string;
}

interface YouTubeStream {
  cameraId: string;
  status: "connecting" | "live" | "error";
  startedAt: string;
  progressAgeMs: number | null;
  error: string | null;
}
type SizeHistory = Record<string, { size: number; lastGrowthAt: number; startedAt: string }>;

function duration(start: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}
function fileSize(bytes: number | null): string {
  if (bytes === null) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(2)} ${units[index]}`;
}
let operatorToken = "";
async function request(url: string, options?: RequestInit): Promise<any> {
  const headers = new Headers(options?.headers);
  if (operatorToken) headers.set("Authorization", `Bearer ${operatorToken}`);
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
function savedLabels(nodeId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`tournament-camera-labels-${nodeId}`) ?? "{}"); }
  catch { return {}; }
}
function savedMicrophones(nodeId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`tournament-camera-microphones-${nodeId}`) ?? "{}"); }
  catch { return {}; }
}

interface SessionAssignment {
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  ring: string;
}
interface TournamentSession {
  eventId?: string;
  eventName: string;
  assignments: SessionAssignment[];
}
interface NodeInfo {
  id: string;
  name: string;
  online: boolean;
  local: boolean;
}

type OperationsAlertSeverity = "critical" | "warning";
interface OperationsAlertInput { key: string; severity: OperationsAlertSeverity; message: string }
interface OperationsAlertRecord extends OperationsAlertInput {
  firstSeen: string; lastSeen: string; acknowledgedAt?: string; resolvedAt?: string;
}
function OperationsAlertHistory({ nodeId, eventId, alerts, online }: {
  nodeId: string; eventId: string; alerts: OperationsAlertInput[]; online: boolean;
}) {
  const storageKey = `tournament-operations-alerts-v1:${nodeId}:${eventId || "unsaved"}`;
  const [records, setRecords] = useState<OperationsAlertRecord[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const preferenceKey = `tournament-alert-audio-v1:${nodeId}`;
  const [audioPrefs, setAudioPrefs] = useState<{ enabled: boolean; severity: OperationsAlertSeverity; cooldownSeconds: number }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      return { enabled: false, severity: stored.severity === "warning" ? "warning" : "critical",
        cooldownSeconds: [15, 30, 60, 120, 300].includes(stored.cooldownSeconds) ? stored.cooldownSeconds : 60 };
    } catch { return { enabled: false, severity: "critical", cooldownSeconds: 60 }; }
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundedAlertsRef = useRef<Set<string>>(new Set());
  const lastSoundRef = useRef(0);
  const audioArmedRef = useRef(false);
  function playAlert() {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== "running") return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, ctx.currentTime);
    oscillator.frequency.setValueAtTime(590, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(); oscillator.stop(ctx.currentTime + 0.35);
  }
  async function toggleAudio() {
    if (audioPrefs.enabled) {
      setAudioPrefs(p => ({ ...p, enabled: false }));
      return;
    }
    try {
      const ctx = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = ctx;
      await ctx.resume();
      if (ctx.state !== "running") throw new Error("Audio playback was blocked by the browser");
      audioArmedRef.current = true;
      // Existing alerts should not sound immediately when enabling audio.
      soundedAlertsRef.current = new Set(records.filter(r => !r.resolvedAt).map(r => `${r.key}:${r.firstSeen}`));
      setAudioPrefs(p => ({ ...p, enabled: true }));
    } catch { setAudioPrefs(p => ({ ...p, enabled: false })); }
  }
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ severity: audioPrefs.severity,
      cooldownSeconds: audioPrefs.cooldownSeconds })); } catch { /* storage unavailable */ }
  }, [preferenceKey, audioPrefs.severity, audioPrefs.cooldownSeconds]);
  useEffect(() => {
    soundedAlertsRef.current.clear();
    lastSoundRef.current = 0;
    audioArmedRef.current = false;
    setAudioPrefs(p => ({ ...p, enabled: false }));
    return () => { const ctx = audioContextRef.current; audioContextRef.current = null; if (ctx) void ctx.close(); };
  }, [storageKey]);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setRecords(Array.isArray(stored) ? stored.filter((r: unknown) =>
        typeof r === "object" && r !== null && typeof (r as OperationsAlertRecord).key === "string").slice(0, 200) : []);
    } catch { setRecords([]); }
  }, [storageKey]);
  useEffect(() => {
    // Do not resolve alerts while disconnected or during incomplete initial data loading.
    if (!online) return;
    const stamp = new Date().toISOString();
    setRecords(previous => {
      const current = new Map(alerts.map(a => [a.key, a]));
      const existing = new Set(previous.filter(r => !r.resolvedAt).map(r => r.key));
      const updated = previous.map(r => {
        if (r.resolvedAt) return r;
        const active = current.get(r.key);
        return active ? (active.message === r.message && active.severity === r.severity ? r :
          { ...r, message: active.message, severity: active.severity, lastSeen: stamp }) :
          { ...r, resolvedAt: stamp, lastSeen: stamp };
      });
      for (const alert of alerts) if (!existing.has(alert.key))
        updated.unshift({ ...alert, firstSeen: stamp, lastSeen: stamp });
      return updated.slice(0, 200);
    });
  }, [online, alerts.map(a => `${a.key}:${a.severity}:${a.message}`).sort().join("|")]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(records)); } catch { /* storage unavailable */ }
  }, [storageKey, records]);
  const active = records.filter(r => !r.resolvedAt);
  const unacknowledged = active.filter(r => !r.acknowledgedAt);
  useEffect(() => {
    if (!online || !audioPrefs.enabled || !audioArmedRef.current) return;
    const candidates = records.filter(r => !r.resolvedAt && !r.acknowledgedAt &&
      (audioPrefs.severity === "warning" || r.severity === "critical"));
    const unseen = candidates.filter(r => !soundedAlertsRef.current.has(`${r.key}:${r.firstSeen}`));
    if (!unseen.length) return;
    // Mark as handled even during cooldown so old alerts don't generate delayed sounds.
    unseen.forEach(r => soundedAlertsRef.current.add(`${r.key}:${r.firstSeen}`));
    const now = Date.now();
    if (now - lastSoundRef.current >= audioPrefs.cooldownSeconds * 1000) {
      playAlert(); lastSoundRef.current = now;
    }
  }, [records, online, audioPrefs.enabled, audioPrefs.severity, audioPrefs.cooldownSeconds]);
  const displayed = showResolved ? records : active;
  function acknowledge(key: string, firstSeen: string) {
    const stamp = new Date().toISOString();
    setRecords(previous => previous.map(r => r.key === key && r.firstSeen === firstSeen && !r.resolvedAt ?
      { ...r, acknowledgedAt: stamp } : r));
  }
  return <section className="session-panel" aria-label="Operations alert history">
    <div className="section-heading"><h3>Operations alerts</h3>
      <span className="muted">{active.length} active · {unacknowledged.length} unacknowledged</span></div>
    <p className="muted">Acknowledgement records that an operator saw the alert. It does not fix or silence the underlying issue.
      Alert history is stored in this browser, separately for each node and event.</p>
    <div className="field" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" onClick={() => void toggleAudio()} aria-pressed={audioPrefs.enabled}>
        {audioPrefs.enabled ? "Disable audible alerts" : "Enable audible alerts"}
      </button>
      <label>Sound for <select value={audioPrefs.severity}
        onChange={e => setAudioPrefs(p => ({ ...p, severity: e.target.value as OperationsAlertSeverity }))}>
        <option value="critical">Critical only</option><option value="warning">Warnings and critical</option>
      </select></label>
      <label>Minimum time between sounds <select value={audioPrefs.cooldownSeconds}
        onChange={e => setAudioPrefs(p => ({ ...p, cooldownSeconds: Number(e.target.value) }))}>
        {[15, 30, 60, 120, 300].map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}
      </select></label>
    </div>
    <p className="muted">Audio requires clicking Enable on this browser tab. It sounds once for a newly detected, unacknowledged alert,
      subject to the cooldown. Existing alerts do not sound when enabling. Sound is not a substitute for visual monitoring.</p>
    <label><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show resolved alerts</label>
    {!online && <p role="status">Node disconnected. Alert state may be stale; automatic resolution is paused.</p>}
    {displayed.length === 0 ? <p>No {showResolved ? "recorded" : "active"} alerts.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Severity</th><th>Problem</th><th>First seen</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{displayed.map(r => <tr key={`${r.key}:${r.firstSeen}`}>
        <td><strong className={r.severity === "critical" ? "camera-warning" : ""}>{r.severity.toUpperCase()}</strong></td>
        <td>{r.message}</td><td>{new Date(r.firstSeen).toLocaleString()}</td>
        <td>{r.resolvedAt ? `Resolved ${new Date(r.resolvedAt).toLocaleString()}` :
          r.acknowledgedAt ? `Acknowledged ${new Date(r.acknowledgedAt).toLocaleString()}` : "Needs acknowledgement"}</td>
        <td>{!r.resolvedAt && !r.acknowledgedAt ? <button type="button" onClick={() => acknowledge(r.key, r.firstSeen)}>Acknowledge</button> : ""}</td>
      </tr>)}</tbody></table></div>}
    <p className="muted">Warnings are based on detected node state. An idle camera or relay is not automatically an alert.</p>
  </section>;
}

interface IncidentEntry {
  id: string;
  timestamp: string;
  operator: string;
  ring: string;
  category: string;
  description: string;
  resolution: string;
  resolvedAt?: string;
  sourceAlertKey?: string;
  autoCreated?: boolean;
  impact?: "none" | "degraded" | "interrupted";
  recoveryAction?: string;
}
type PostTournamentReport = {
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
const POST_TOURNAMENT_COMPARISON_KEY = "tournament-post-technical-snapshots-v1";
function readPostTournamentSnapshots(): PostTournamentReport[] {
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
function TournamentToTournamentComparison() {
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

function TournamentReliabilityTrends() {
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

function PostTournamentTechnicalReport({ nodeId, eventId, eventName, requestNode }: {
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

function IncidentAnalytics({ nodeId, eventId }: { nodeId: string; eventId: string }) {
  const storageKey = `tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`;
  const [entries, setEntries] = useState<IncidentEntry[]>([]);
  const [windowHours, setWindowHours] = useState(24);
  const refresh = () => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setEntries(Array.isArray(raw) ? raw.filter((e): e is IncidentEntry =>
        !!e && typeof e === "object" && typeof e.id === "string" &&
        typeof e.timestamp === "string" && Number.isFinite(Date.parse(e.timestamp))) : []);
    } catch { setEntries([]); }
  };
  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, [storageKey]);
  const cutoff = Date.now() - windowHours * 3600000;
  const recent = entries.filter(e => Date.parse(e.timestamp) >= cutoff);
  const closed = recent.filter(e => e.resolvedAt && Number.isFinite(Date.parse(e.resolvedAt)) &&
    Date.parse(e.resolvedAt) >= Date.parse(e.timestamp));
  const durations = closed.map(e => (Date.parse(e.resolvedAt!) - Date.parse(e.timestamp)) / 60000);
  const average = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const groups = new Map<string, IncidentEntry[]>();
  for (const e of recent) {
    const ring = e.ring?.trim() || "Unassigned";
    groups.set(ring, [...(groups.get(ring) || []), e]);
  }
  const ringRows = [...groups].map(([ring, items]) => ({
    ring, total: items.length, open: items.filter(e => !e.resolvedAt).length,
    interruptions: items.filter(e => e.impact === "interrupted").length,
    last: items.reduce((max, e) => Math.max(max, Date.parse(e.timestamp)), 0)
  })).sort((a, b) => b.total - a.total || a.ring.localeCompare(b.ring));
  const categoryRows = [...new Set(recent.map(e => e.category?.trim() || "Uncategorized"))]
    .map(category => ({ category, count: recent.filter(e => (e.category?.trim() || "Uncategorized") === category).length }))
    .sort((a, b) => b.count - a.count);
  const download = () => {
    const report = { exportedAt: new Date().toISOString(), nodeId, eventId, windowHours,
      note: "Browser-local operator incident records; not independently measured service downtime.",
      total: recent.length, open: recent.filter(e => !e.resolvedAt).length,
      resolved: closed.length, averageResolutionMinutes: average, rings: ringRows,
      categories: categoryRows, incidents: recent };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `incident-analytics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="session-panel" aria-label="Tournament incident analytics">
    <div className="section-heading"><h3>Incident analytics and recurring issues</h3>
      <button type="button" onClick={download}>Export analytics JSON</button></div>
    <label>Analysis period <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))}>
      {[1, 6, 24, 72, 168, 720].map(hours => <option key={hours} value={hours}>Last {hours} hours</option>)}
    </select></label>
    <div className="overview">
      <div className="metric"><span>Incidents</span><strong>{recent.length}</strong></div>
      <div className="metric"><span>Unresolved</span><strong>{recent.filter(e => !e.resolvedAt).length}</strong></div>
      <div className="metric"><span>Interrupted</span><strong>{recent.filter(e => e.impact === "interrupted").length}</strong></div>
      <div className="metric"><span>Mean operator closure</span><strong>{average === null ? "No data" : `${average.toFixed(1)} min`}</strong></div>
    </div>
    <h4>Incidents by ring</h4>
    {ringRows.length === 0 ? <p className="muted">No recorded incidents in this period.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Ring</th><th>Total</th><th>Open</th>
        <th>Interruptions</th><th>Latest incident</th></tr></thead><tbody>
        {ringRows.map(row => <tr key={row.ring}><td>{row.ring}</td><td>{row.total}</td>
          <td>{row.open}</td><td>{row.interruptions}</td><td>{new Date(row.last).toLocaleString()}</td></tr>)}
      </tbody></table></div>}
    <h4>Incident categories</h4>
    {categoryRows.length > 0 && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Category</th><th>Count</th></tr></thead>
      <tbody>{categoryRows.map(row => <tr key={row.category}><td>{row.category}</td><td>{row.count}</td></tr>)}</tbody></table></div>}
    <p className="muted">Counts reflect only incidents retained in this browser for this event and node (maximum 300).
      Repeated entries can indicate recurring problems but are not independent measurements of camera or stream availability.
      Closure time is based on manual operator action; open incidents are excluded from the mean.</p>
  </section>;
}

function IncidentTrends({ nodeId, eventId }: { nodeId: string; eventId: string }) {
  const storageKey = `tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`;
  const [entries, setEntries] = useState<IncidentEntry[]>([]);
  const [windowHours, setWindowHours] = useState(24);
  const [bucketHours, setBucketHours] = useState(1);
  useEffect(() => {
    const refresh = () => {
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
        setEntries(Array.isArray(raw) ? raw.filter((entry): entry is IncidentEntry =>
          !!entry && typeof entry === "object" && typeof entry.id === "string" &&
          typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp))) : []);
      } catch { setEntries([]); }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [storageKey]);
  const now = Date.now();
  const end = Math.ceil(now / 3600000) * 3600000;
  const start = end - windowHours * 3600000;
  const stepMs = bucketHours * 3600000;
  const bucketCount = Math.ceil(windowHours / bucketHours);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const from = start + index * stepMs;
    const to = Math.min(end, from + stepMs);
    const items = entries.filter(e => {
      const t = Date.parse(e.timestamp);
      return t >= from && t < to;
    });
    return { from, to, total: items.length, interrupted: items.filter(e => e.impact === "interrupted").length,
      degraded: items.filter(e => e.impact === "degraded").length };
  });
  const maximum = Math.max(1, ...buckets.map(b => b.total));
  const midpoint = start + (end - start) / 2;
  const earlier = entries.filter(e => { const t = Date.parse(e.timestamp); return t >= start && t < midpoint; });
  const later = entries.filter(e => { const t = Date.parse(e.timestamp); return t >= midpoint && t < end; });
  const earlierInterruptions = earlier.filter(e => e.impact === "interrupted").length;
  const laterInterruptions = later.filter(e => e.impact === "interrupted").length;
  const trend = laterInterruptions < earlierInterruptions ? "Fewer reported interruptions in second half" :
    laterInterruptions > earlierInterruptions ? "More reported interruptions in second half" : "No change in reported interruption count";
  function exportTrends() {
    const report = { exportedAt: new Date().toISOString(), nodeId, eventId, windowHours, bucketHours,
      periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(), buckets,
      earlierHalf: { incidents: earlier.length, interruptions: earlierInterruptions },
      laterHalf: { incidents: later.length, interruptions: laterInterruptions }, trend,
      limitations: ["Operator-recorded incidents, not measured stream uptime.",
        "Browser-local records, capped at 300; empty buckets do not prove zero downtime.",
        "Time bins use local clock labels and are aligned to UTC hour boundaries.",
        "Differences between halves are descriptive and do not establish improving reliability."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `incident-trends-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const formatTime = (time: number) => new Date(time).toLocaleString(undefined,
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <section className="session-panel" aria-label="Tournament incident trends">
    <div className="section-heading"><h3>Incident trends over time</h3>
      <button type="button" onClick={exportTrends}>Export trends JSON</button></div>
    <div className="field" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      <label>Analysis period <select value={windowHours} onChange={e => {
        const hours = Number(e.target.value); setWindowHours(hours);
        setBucketHours(hours <= 24 ? 1 : hours <= 168 ? 6 : 24);
      }}>
        {[6, 24, 72, 168, 720].map(hours => <option key={hours} value={hours}>Last {hours} hours</option>)}
      </select></label>
      <label>Time interval <select value={bucketHours} onChange={e => setBucketHours(Number(e.target.value))}>
        {[1, 6, 12, 24].filter(hours => hours <= windowHours).map(hours =>
          <option key={hours} value={hours}>{hours} hour{hours === 1 ? "" : "s"}</option>)}
      </select></label>
    </div>
    <div className="overview">
      <div className="metric"><span>First half interruptions</span><strong>{earlierInterruptions}</strong></div>
      <div className="metric"><span>Second half interruptions</span><strong>{laterInterruptions}</strong></div>
      <div className="metric"><span>Total reported incidents</span><strong>{earlier.length + later.length}</strong></div>
    </div>
    <p><strong>{trend}</strong>. Each half covers the same duration; counts are not adjusted for camera operating hours.</p>
    <h4>Reported incidents by time interval</h4>
    {buckets.every(b => b.total === 0) ? <p className="muted">No incident records in this period.</p> :
      <div style={{ overflowX: "auto" }}><div style={{ display: "flex", alignItems: "end", gap: 4,
        height: 175, minWidth: Math.max(420, buckets.length * 20), padding: "12px 4px 0" }}
        role="img" aria-label="Bar chart of incident counts by time interval">
        {buckets.map(b => <div key={b.from} title={`${formatTime(b.from)}: ${b.total} incidents, ${b.interrupted} interruptions`}
          style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "end", alignItems: "stretch" }}>
          <span style={{ fontSize: 10, textAlign: "center" }}>{b.total || ""}</span>
          <div style={{ height: `${(b.total / maximum) * 125}px`, background: "#5589b4", minHeight: b.total ? 3 : 0 }} />
          <div style={{ height: 4, background: b.interrupted ? "#d65a4a" : "transparent" }} />
        </div>)}
      </div></div>}
    <p className="muted">Blue bars: reported incidents. Red marks: intervals containing at least one reported interruption.</p>
    <div style={{ overflowX: "auto", maxHeight: 330 }}><table><thead><tr><th>Interval start</th><th>Incidents</th>
      <th>Interrupted</th><th>Degraded</th></tr></thead><tbody>
      {buckets.map(b => <tr key={b.from}><td>{formatTime(b.from)}</td><td>{b.total}</td>
        <td>{b.interrupted}</td><td>{b.degraded}</td></tr>)}
    </tbody></table></div>
    <p className="muted">This chart uses operator-reported incidents stored in this browser for this event and node.
      It does not measure actual downtime. Browser storage retains at most 300 incident records, so older trends may be incomplete.
      A lower count does not necessarily mean reliability improved, especially if fewer cameras were operating.</p>
  </section>;
}

function IncidentHeatmap({ nodeId, eventId }: { nodeId: string; eventId: string }) {
  const storageKey = `tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`;
  const [entries, setEntries] = useState<IncidentEntry[]>([]);
  const [windowHours, setWindowHours] = useState(24);
  const [onlyInterruptions, setOnlyInterruptions] = useState(false);
  useEffect(() => {
    const refresh = () => {
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
        setEntries(Array.isArray(raw) ? raw.filter((item): item is IncidentEntry =>
          !!item && typeof item === "object" && typeof item.id === "string" &&
          typeof item.timestamp === "string" && Number.isFinite(Date.parse(item.timestamp))) : []);
      } catch { setEntries([]); }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [storageKey]);
  const cutoff = Date.now() - windowHours * 3600000;
  const relevant = entries.filter(item => Date.parse(item.timestamp) >= cutoff &&
    Date.parse(item.timestamp) <= Date.now() && (!onlyInterruptions || item.impact === "interrupted"));
  const rings = [...new Set(relevant.map(item => item.ring.trim() || "Unassigned"))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = rings.map(ring => ({ ring, hours: Array.from({ length: 24 }, (_, hour) => {
    const matches = relevant.filter(item => (item.ring.trim() || "Unassigned") === ring &&
      new Date(item.timestamp).getHours() === hour);
    return { hour, count: matches.length, interruptions: matches.filter(item => item.impact === "interrupted").length };
  }) }));
  const maxCount = Math.max(1, ...rows.flatMap(row => row.hours.map(hour => hour.count)));
  const total = relevant.length;
  function exportHeatmap() {
    const report = { exportedAt: new Date().toISOString(), nodeId, eventId, windowHours,
      onlyInterruptions, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      incidentsIncluded: total, rows,
      limitations: ["Counts are based on operator-reported browser-local incidents, not measured uptime.",
        "Hours represent local clock hour of day aggregated across the selected period, not individual dates.",
        "Incident storage is capped at 300 records; earlier periods may be incomplete.",
        "Daylight-saving transitions may repeat or skip local clock hours."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `incident-heatmap-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Incident heatmap by ring and hour">
    <div className="section-heading"><h3>Incident heatmap by ring and time of day</h3>
      <button type="button" onClick={exportHeatmap}>Export heatmap JSON</button></div>
    <div className="field" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
      <label>Analysis period <select value={windowHours} onChange={e => setWindowHours(Number(e.target.value))}>
        {[24, 72, 168, 720].map(hours => <option key={hours} value={hours}>Last {hours} hours</option>)}
      </select></label>
      <label><input type="checkbox" checked={onlyInterruptions}
        onChange={e => setOnlyInterruptions(e.target.checked)} /> Only service interruptions</label>
    </div>
    <p className="muted">{total} matching incident{total === 1 ? "" : "s"} across {rings.length} ring{rings.length === 1 ? "" : "s"}.
      Each column represents the local hour of day. Multiple dates are combined.</p>
    {rows.length === 0 ? <p>No matching incidents in the selected period.</p> :
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "separate", borderSpacing: 3, minWidth: 790 }}>
        <thead><tr><th scope="col">Ring</th>{Array.from({ length: 24 }, (_, hour) =>
          <th scope="col" key={hour} style={{ fontSize: 10, textAlign: "center", padding: 2 }}>{hour.toString().padStart(2, "0")}</th>)}
          <th scope="col">Total</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.ring}><th scope="row">{row.ring}</th>
          {row.hours.map(cell => {
            const opacity = cell.count ? 0.18 + 0.72 * (cell.count / maxCount) : 0;
            const label = `${row.ring}, ${cell.hour.toString().padStart(2, "0")}:00 to ${((cell.hour + 1) % 24).toString().padStart(2, "0")}:00: ${cell.count} incident(s), ${cell.interruptions} interruption(s)`;
            return <td key={cell.hour} title={label} aria-label={label}
              style={{ textAlign: "center", padding: "6px 2px", minWidth: 22,
                background: cell.count ? `rgba(214, 90, 74, ${opacity})` : "rgba(128, 128, 128, 0.08)",
                fontWeight: cell.count ? 700 : 400 }}>{cell.count || "·"}</td>;
          })}<td><strong>{row.hours.reduce((sum, cell) => sum + cell.count, 0)}</strong></td></tr>)}</tbody>
      </table></div>}
    <p className="muted">Darker cells represent more reports relative to the busiest ring/hour cell in this selection.
      This is not a measure of actual downtime or incident rate per camera operating hour. Records are limited to
      the 300 incidents retained in this browser for this event and node.</p>
  </section>;
}

function IncidentLog({ nodeId, eventId, alerts, online }: {
  nodeId: string; eventId: string; alerts: OperationsAlertInput[]; online: boolean;
}) {
  const key = `tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`;
  const [entries, setEntries] = useState<IncidentEntry[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed.filter((entry): entry is IncidentEntry =>
        !!entry && typeof entry.id === "string" && typeof entry.timestamp === "string" &&
        typeof entry.description === "string").slice(0, 300) : [];
    } catch { return []; }
  });
  const [operator, setOperator] = useState("");
  const [ring, setRing] = useState("");
  const [category, setCategory] = useState("Camera");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState("");
  const [impact, setImpact] = useState<"none" | "degraded" | "interrupted">("interrupted");
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [selectedAlert, setSelectedAlert] = useState("");
  const [notice, setNotice] = useState("");
  const [autoCritical, setAutoCritical] = useState<boolean>(() => {
    try { return localStorage.getItem(`tournament-auto-incidents-v1:${nodeId}`) !== "false"; }
    catch { return true; }
  });
  const criticalSignature = alerts.filter(a => a.severity === "critical")
    .map(a => `${a.key}:${a.message}`).sort().join("|");
  useEffect(() => {
    try { localStorage.setItem(`tournament-auto-incidents-v1:${nodeId}`, String(autoCritical)); }
    catch { /* storage unavailable */ }
  }, [nodeId, autoCritical]);
  useEffect(() => {
    // Critical alerts become incident records once per active occurrence. A closed
    // incident is retained; a future recurrence can create a new record.
    // Never infer incident resolution from an alert clearing: the operator signs off.
    if (!online || !autoCritical) return;
    const critical = alerts.filter(a => a.severity === "critical");
    if (!critical.length) return;
    setEntries(previous => {
      const openKeys = new Set(previous.filter(e => !e.resolvedAt && e.sourceAlertKey)
        .map(e => e.sourceAlertKey));
      const newAlerts = critical.filter(a => !openKeys.has(a.key));
      if (!newAlerts.length) return previous;
      const stamp = new Date().toISOString();
      return [...newAlerts.map(a => ({
        id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        timestamp: stamp, operator: "", ring: "", category: "Other",
        description: a.message.slice(0, 2000), resolution: "", impact: "interrupted",
        sourceAlertKey: a.key, autoCreated: true
      } satisfies IncidentEntry)), ...previous].slice(0, 300);
    });
  // Use the stable signature to avoid rerunning for every dashboard render.
  }, [online, autoCritical, criticalSignature, key]);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(entries)); }
    catch { setNotice("Browser storage unavailable. Export the log before leaving this page."); }
  }, [key, entries]);
  function addIncident() {
    if (!description.trim()) { setNotice("Enter an incident description."); return; }
    const entry: IncidentEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(), operator: operator.trim().slice(0, 100),
      ring: ring.trim().slice(0, 100), category,
      description: description.trim().slice(0, 2000), resolution: resolution.trim().slice(0, 2000), impact
    };
    setEntries(previous => [entry, ...previous].slice(0, 300));
    setDescription(""); setResolution(""); setSelectedAlert("");
    setNotice("Incident recorded in this browser.");
  }
  function closeIncident(id: string) {
    const note = window.prompt("Resolution or follow-up note (optional):", "");
    if (note === null) return;
    setEntries(previous => previous.map(entry => entry.id === id ?
      { ...entry, resolution: note.trim().slice(0, 2000), recoveryAction: note.trim().slice(0, 2000), resolvedAt: new Date().toISOString() } : entry));
  }
  function download(format: "json" | "csv") {
    const header = ["Timestamp", "Operator", "Ring", "Category", "Impact", "Description", "Resolution", "Resolved at", "Duration seconds"];
    const rows = entries.map(e => [e.timestamp, e.operator, e.ring, e.category, e.impact || "unknown", e.description, e.resolution, e.resolvedAt || "", e.resolvedAt ? String(Math.max(0, Math.round((Date.parse(e.resolvedAt) - Date.parse(e.timestamp)) / 1000))) : ""]);
    const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const data = format === "json" ? JSON.stringify({ nodeId, eventId, exportedAt: new Date().toISOString(), incidents: entries }, null, 2) :
      [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([format === "csv" ? "\uFEFF" + data : data], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tournament-incidents-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visibleEntries = entries.filter(e => filter === "all" || (filter === "open" ? !e.resolvedAt : !!e.resolvedAt));
  const resolved = entries.filter(e => e.resolvedAt && Number.isFinite(Date.parse(e.resolvedAt)) && Number.isFinite(Date.parse(e.timestamp)));
  const totalSeconds = resolved.reduce((sum, e) => sum + Math.max(0, (Date.parse(e.resolvedAt!) - Date.parse(e.timestamp)) / 1000), 0);
  const durationLabel = (e: IncidentEntry) => e.resolvedAt && Number.isFinite(Date.parse(e.resolvedAt)) && Number.isFinite(Date.parse(e.timestamp))
    ? `${Math.max(0, Math.round((Date.parse(e.resolvedAt) - Date.parse(e.timestamp)) / 60))} min` : "Open";
  return <section className="session-panel" aria-label="Tournament incident log">
    <div className="section-heading"><h3>Operator incident log</h3><span className="muted">{entries.length} recorded</span></div>
    <div className="overview" aria-label="Incident summary">
      <div className="metric"><span>Open</span><strong>{entries.filter(e => !e.resolvedAt).length}</strong></div>
      <div className="metric"><span>Resolved</span><strong>{resolved.length}</strong></div>
      <div className="metric"><span>Interrupted</span><strong>{entries.filter(e => e.impact === "interrupted").length}</strong></div>
      <div className="metric"><span>Average time to resolve</span><strong>{resolved.length ? `${Math.round(totalSeconds / resolved.length / 60)} min` : "N/A"}</strong></div>
    </div>
    <p className="muted">Resolution time is measured from the recorded incident timestamp to manual operator closure. It is not independently measured camera downtime.</p>
    <p className="muted">Record equipment faults, workarounds, and operator actions. Entries are saved in this browser
      for this node and event, not synchronized to other PCs. Export regularly for a permanent record.</p>
    <label><input type="checkbox" checked={autoCritical} onChange={e => setAutoCritical(e.target.checked)} />
      Automatically create an incident for each active critical alert</label>
    <p className="muted">Critical alerts are recorded once while their incident remains open. Alert acknowledgement
      or recovery does not resolve an incident. Mark it resolved after documenting the outcome.</p>
    <div className="field"><label>Operator <input maxLength={100} value={operator} onChange={e => setOperator(e.target.value)} placeholder="Operator name" /></label>
      <label>Ring / equipment <input maxLength={100} value={ring} onChange={e => setRing(e.target.value)} placeholder="Ring 3" /></label>
      <label>Category <select value={category} onChange={e => setCategory(e.target.value)}>
        {["Camera", "Microphone", "Recording", "YouTube", "USB", "Storage", "Network", "Other"].map(value =>
          <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Operational impact <select value={impact} onChange={e => setImpact(e.target.value as typeof impact)}>
        <option value="interrupted">Recording or stream interrupted</option>
        <option value="degraded">Degraded, still operating</option>
        <option value="none">No service impact</option>
      </select></label></div>
    <div className="field"><label>Copy an active alert into the description <select value={selectedAlert}
      onChange={e => { setSelectedAlert(e.target.value); const alert = alerts.find(a => a.key === e.target.value);
        if (alert) setDescription(alert.message); }}>
      <option value="">Select alert (optional)</option>
      {alerts.map(a => <option key={a.key} value={a.key}>{a.severity}: {a.message}</option>)}
    </select></label></div>
    <div className="field"><label>Incident description <textarea rows={2} maxLength={2000} value={description}
      onChange={e => setDescription(e.target.value)} placeholder="What happened and when?" /></label></div>
    <div className="field"><label>Action taken / notes <textarea rows={2} maxLength={2000} value={resolution}
      onChange={e => setResolution(e.target.value)} placeholder="Troubleshooting or workaround (optional)" /></label></div>
    <div className="field"><button type="button" onClick={addIncident}>Record incident</button>
      <button type="button" onClick={() => download("csv")} disabled={!entries.length}>Export CSV</button>
      <button type="button" onClick={() => download("json")} disabled={!entries.length}>Export JSON</button></div>
    {notice && <p role="status">{notice}</p>}
    <label>Show incidents <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
      <option value="all">All</option><option value="open">Open only</option><option value="resolved">Resolved only</option>
    </select></label>
    {entries.length === 0 ? <p className="muted">No incidents logged for this event and node.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Time</th><th>Operator</th><th>Ring</th><th>Category</th>
        <th>Impact</th><th>Incident</th><th>Notes</th><th>Status</th><th>Duration</th><th>Action</th></tr></thead><tbody>
        {visibleEntries.map(entry => <tr key={entry.id}><td>{new Date(entry.timestamp).toLocaleString()}</td>
          <td>{entry.operator || "Not specified"}</td><td>{entry.ring || "General"}</td><td>{entry.category}</td>
          <td>{entry.impact || "Unknown"}</td><td>{entry.autoCreated ? "[Automatic] " : ""}{entry.description}</td><td>{entry.resolution || ""}</td>
          <td>{entry.resolvedAt ? `Resolved ${new Date(entry.resolvedAt).toLocaleString()}` : "Open"}</td>
          <td>{durationLabel(entry)}</td>
          <td>{!entry.resolvedAt && <button type="button" onClick={() => closeIncident(entry.id)}>Mark resolved</button>}</td>
        </tr>)}</tbody></table></div>}
  </section>;
}

interface CameraQualitySnapshot {
  width: number;
  height: number;
  fps: number;
  recordingBitrateMbps: number;
  streamingBitrateKbps: number;
}
function validCameraQuality(value: unknown): value is CameraQualitySnapshot {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return ["width", "height", "fps", "recordingBitrateMbps", "streamingBitrateKbps"]
    .every(key => typeof q[key] === "number" && Number.isFinite(q[key]) && (q[key] as number) > 0);
}
interface IncidentTimelineEvent {
  id: string;
  at: string;
  type: string;
  detail: string;
  source: "Alert" | "Incident";
  severity?: string;
}
function TournamentTechnicalSummary({ nodeId, eventId, eventName, requestNode }: {
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


type ArchivedEventReport = {
  generatedAt: string; nodeId: string; eventId: string; eventName: string;
  recording: { totals: { sessions: number; failures: number; warnings: number };
    cameras: Array<{ cameraId: string; ring?: string | null; sessions: number; failures: number; warnings: number }> };
  alerts: Array<{ severity: string; resolvedAt?: string }>;
  incidents: Array<{ resolvedAt?: string }>;
  qualitySnapshot?: Record<string, CameraQualitySnapshot>;
};
const EVENT_ARCHIVE_KEY = "tournament-event-report-archive-v1";
function isArchivedEventReport(value: unknown): value is ArchivedEventReport {
  if (!value || typeof value !== "object") return false;
  const r = value as any;
  return typeof r.generatedAt === "string" && Number.isFinite(Date.parse(r.generatedAt)) &&
    typeof r.nodeId === "string" && typeof r.eventId === "string" &&
    typeof r.eventName === "string" && !!r.recording &&
    !!r.recording.totals && ["sessions", "failures", "warnings"].every(
      key => typeof r.recording.totals[key] === "number" && Number.isFinite(r.recording.totals[key])) &&
    Array.isArray(r.recording.cameras) && Array.isArray(r.alerts) && Array.isArray(r.incidents);
}
type RecordingConfigurationReliability = {
  scannedSessions: number; unknownConfiguration: number; truncated: boolean; note: string;
  configurations: Array<{ key: string; width: number; height: number; fps: number;
    inputWidth: number; inputHeight: number; inputFps: number; inputFormat: string;
    recordingBitrateMbps: number; streamingBitrateKbps: number;
    sessions: number; completed: number; failed: number; stopped: number;
    active: number; unfinished: number; failureRatePercent: number | null }>;
};
function RecordingConfigurationReliabilityPanel({ requestNode }: {
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

type CameraConfigurationReliabilityReport = {
  scannedSessions: number; unknownConfiguration: number; truncated: boolean; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; configurationKey: string;
    requested: { width: number; height: number; fps: number; recordingBitrateMbps: number; streamingBitrateKbps: number };
    selectedInput: { width: number; height: number; fps: number; format: string };
    sessions: number; stopped: number; failed: number; active: number; unfinished: number;
    completed: number; failureRatePercent: number | null }>;
};
function CameraConfigurationReliabilityPanel({ requestNode }: {
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

type ReliabilityWarningReport = {
  generatedAt: string; scannedSessions: number; excluded: number; evaluatedGroups: number;
  truncated: boolean; note: string;
  thresholds: { minCompleted: number; minFailed: number; minFailureRatePercent: number };
  knownIssues?: Array<{ cameraId: string; note: string; updatedAt: string }>;
  warnings: Array<{ code: string; severity: string; cameraId?: string; cameraName?: string;
    configurationKey?: string; completed: number; failed: number;
    failureRatePercent: number; message: string }>;
};
type CameraHealthReport = {
  checkedAt: string; scannedSessions: number; truncated: boolean; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; connected: boolean;
    recordingActive: boolean; completedSessions: number; failedSessions: number;
    failureRatePercent: number | null; knownIssue: { note: string; updatedAt: string } | null;
    repeatedFailures: boolean; warnings: string[]; status: string }>;
};
function CameraHealthPanel({ requestNode }: {
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

type CameraHealthHistoryEvent = {
  at: string; cameraId: string; cameraName: string; connected: boolean;
  recordingActive: boolean; field: "baseline" | "connection" | "recording";
  previous: boolean | null; current: boolean;
};
type CameraHealthHistoryResponse = {
  checkedAt: string; trackedCameras: number; totalRetainedEvents: number;
  historyLimit: number; note: string; events: CameraHealthHistoryEvent[];
};
function CameraHealthHistoryPanel({ requestNode }: {
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

type DisconnectionSummary = {
  checkedAt: string; retainedEvents: number; note: string;
  cameras: Array<{ cameraId: string; cameraName: string; disconnects: number;
    reconnects: number; completedOutages: number; observedDowntimeMs: number;
    longestCompletedOutageMs: number; currentlyDisconnected: boolean;
    openOutageSince: string | null; firstObservedAt: string | null }>;
};
function CameraDisconnectionAnalysis({ requestNode }: {
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

type UsbRecordingCorrelationReport = {
  checkedAt: string; windowSeconds: number; observedDisconnects: number; sessionsAnalyzed: number;
  cameras: Array<{ cameraId: string; cameraName: string; completed: number; failed: number;
    sessionsWithDisconnect: number; failedWithDisconnect: number; failedWithoutDisconnect: number; unknownIntervals: number }>;
  sessions: Array<{ cameraId: string; cameraName: string; startedAt: string; outcome: string;
    matchingDisconnects: number; disconnectTimes: string[] }>;
  limitations: string[];
};
function UsbRecordingCorrelationPanel({ requestNode }: {
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

type DiagnosticThresholds = {
  cpuPercent: number; gpuPercent: number; ramPercent: number;
  diskWriteMiBps: number; minimumUsbDisconnects: number;
};
type FailureInvestigationReport = {
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
type CameraReliabilitySummary = {
  generatedAt: string;
  totals: { cameras: number; recordings: number; failedRecordings: number; usbDisconnects: number };
  cameras: Array<{ cameraId: string; cameraName: string; recordings: number; completed: number;
    failures: number; activeOrUnknown: number; usbDisconnects: number; usbReconnects: number;
    lastFailureAt: string | null; lastDisconnectAt: string | null }>;
  limitations: string[];
};
type ReadinessCheck = { name: string; state: "pass" | "warning" | "blocker" | "unknown"; detail: string };
type PreTournamentAction = {
  id: string; priority: "blocker" | "warning" | "unknown";
  source: "readiness" | "maintenance" | "incident";
  title: string; detail: string; nextStep: string;
};
const preTournamentPriority = { blocker: 0, warning: 1, unknown: 2 } as const;
function readOpenTournamentIncidents(nodeId: string, eventId: string): { entries: IncidentEntry[]; error: string | null } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`tournament-incident-log-v1:${nodeId}:${eventId || "unsaved"}`) || "[]");
    if (!Array.isArray(value)) return { entries: [], error: "Incident history has an invalid format." };
    return { entries: value.filter((entry): entry is IncidentEntry => !!entry && typeof entry === "object" &&
      typeof entry.id === "string" && typeof entry.timestamp === "string" &&
      !entry.resolvedAt), error: null };
  } catch (error) { return { entries: [], error: `Incident history unavailable: ${String(error)}` }; }
}
function buildPreTournamentActions(checks: ReadinessCheck[], nodeId: string, eventId: string): PreTournamentAction[] {
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
type ReadinessSnapshot = {
  id: string; nodeId: string; eventId: string; checkedAt: string; savedAt: string;
  checks: ReadinessCheck[]; actions: PreTournamentAction[]; limitations: string[];
};
function readinessSnapshotKey(nodeId: string, eventId: string) {
  return `tournament-readiness-snapshots-v1:${nodeId}:${eventId || "unsaved"}`;
}
function loadReadinessSnapshots(nodeId: string, eventId: string): ReadinessSnapshot[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(readinessSnapshotKey(nodeId, eventId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is ReadinessSnapshot => !!v && typeof v === "object" &&
      typeof v.id === "string" && typeof v.checkedAt === "string" &&
      v.nodeId === nodeId && v.eventId === eventId && Array.isArray(v.checks) && Array.isArray(v.actions))
      .slice(0, 30);
  } catch { return []; }
}
function ReadinessSnapshotHistory({ nodeId, eventId, current }: {
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
type LaunchDecision = { version: 1; nodeId: string; eventId: string; checkedAt: string;
  assignmentFingerprint: string; ringSignedAt: string; operator: string;
  authorizedAt: string; warningsAcknowledged: boolean; decision: "GO" };
function TournamentLaunchAuthorization({ nodeId, eventId, assignments, snapshot }: {
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
type TournamentProcedureRecord = { version: 1; nodeId: string; eventId: string; updatedAt: string;
  checks: Record<string, boolean>; notes: string; operator: string; observations: Array<{
    at: string; recording: number; streaming: number; frozen: number; expected: number;
    cameraStatus: Array<{ ring: string; cameraId: string; recording: boolean; streaming: string; frozen: boolean }>;
  }> };
const tournamentProcedureSteps = [
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
function TournamentLaunchShutdownGuide({ nodeId, eventId, assignments, captures, streams, requestNode }: {
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
function TournamentReadinessOverview({ requestNode, readiness, readinessCurrent, captures, streamCount, nodeId, eventId, assignments }: {
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
    const running = captures.filter(c => c.running);
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
      {snapshot.actions.length === 0 ? <p>No outstanding actions identified in the available checks. Complete the per-ring operator sign-off and end-to-end streaming test separately.</p> :
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Priority</th><th>Source</th><th>Issue</th><th>Recommended next step</th></tr></thead><tbody>
          {snapshot.actions.map(action => <tr key={action.id}><td>{action.priority.toUpperCase()}</td><td>{action.source}</td>
            <td><strong>{action.title}</strong><p>{action.detail}</p></td><td>{action.nextStep}</td></tr>)}
        </tbody></table></div>}
      <p className="muted">This list is a snapshot of browser-local incidents and maintenance records plus node readiness measurements. Refresh after making changes. It does not automatically clear incidents or complete maintenance tasks.</p>
      <small>{snapshot.limitations.join(" ")}</small>
    </>}
    <ReadinessSnapshotHistory nodeId={nodeId} eventId={eventId} current={snapshot} />
    <TournamentLaunchAuthorization nodeId={nodeId} eventId={eventId} assignments={assignments} snapshot={snapshot} />
  </section>;
}

function CameraReliabilityDashboard({ requestNode }: { requestNode: (url: string, options?: RequestInit) => Promise<any> }) {
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

function FailureInvestigationPanel({ requestNode }: {
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

type GuidedTestStatus = "not-run" | "pass" | "fail" | "inconclusive";
type GuidedTestEntry = { status: GuidedTestStatus; notes: string; updatedAt: string | null };
type GuidedTestId = "baseline" | "usb" | "encoder" | "storage" | "verification";
const guidedTestSteps: Array<{ id: GuidedTestId; title: string; instructions: string[] }> = [
  { id: "baseline", title: "Baseline: reproduce the issue", instructions: [
    "Record which cameras are connected, their USB ports, capture settings, and recording destination.",
    "With a safe test event, record all intended cameras for at least 30 seconds and export the stress-test JSON.",
    "Note any failures and timestamps before changing one variable at a time."
  ] },
  { id: "usb", title: "USB isolation", instructions: [
    "Stop the affected camera recording before moving its USB cable. Do not unplug a live recording.",
    "Try the same camera and settings on a different verified USB host controller, then repeat the test.",
    "If the problem follows the camera, test a known-good cable; if it follows the port, investigate the port/controller."
  ] },
  { id: "encoder", title: "Capture and encoding isolation", instructions: [
    "Save the original settings and ensure no tournament stream depends on the camera before making changes.",
    "Repeat a test at 1080p30 instead of 1080p60, if supported, while keeping the same USB port and storage path.",
    "Compare FFmpeg logs, dropped/stale preview indicators, CPU and GPU samples; revert settings afterward."
  ] },
  { id: "storage", title: "Storage isolation", instructions: [
    "Verify free space, recording destination health, and whether other processes are saturating the drive.",
    "During a test event, compare recording to a different healthy local drive if one is available.",
    "Do not move or delete original tournament recordings as part of the test."
  ] },
  { id: "verification", title: "Verify and document", instructions: [
    "Restore intended camera settings and USB connections, then repeat a full multi-camera stress test.",
    "Verify recorded file playback, audio, and YouTube relay status separately.",
    "Record findings and any remaining uncertainty in the incident log; export this worksheet."
  ] }
];
const guidedTestEmpty = (): Record<GuidedTestId, GuidedTestEntry> => ({
  baseline: { status: "not-run", notes: "", updatedAt: null },
  usb: { status: "not-run", notes: "", updatedAt: null },
  encoder: { status: "not-run", notes: "", updatedAt: null },
  storage: { status: "not-run", notes: "", updatedAt: null },
  verification: { status: "not-run", notes: "", updatedAt: null }
});
type SavedGuidedTest = { id: string; savedAt: string; cameraId: string; operator: string;
  steps: Record<GuidedTestId, GuidedTestEntry>; summary: string; changeMade: string };
const GUIDED_HISTORY_KEY = "tournament-guided-troubleshooting-v1";
function readGuidedHistory(): SavedGuidedTest[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GUIDED_HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedGuidedTest => Boolean(item && typeof item === "object" &&
      typeof item.id === "string" && typeof item.savedAt === "string" &&
      typeof item.cameraId === "string" && item.steps && typeof item.steps === "object"))
      .slice(0, 30);
  } catch { return []; }
}
type TroubleshootingEffectivenessRow = { category: string; comparisons: number; improved: number; unchanged: number; regressed: number; inconclusive: number };
function classifyTroubleshootingChange(value: string): string {
  const change = value.toLowerCase();
  if (/usb|controller|port|cable|hub/.test(change)) return "USB connection / controller";
  if (/encod|nvenc|fps|frame.?rate|bitrate|resolution|gpu/.test(change)) return "Encoding / capture settings";
  if (/disk|drive|storage|ssd|write|recording path/.test(change)) return "Storage";
  if (/cpu|memory|ram|process|load/.test(change)) return "System resources";
  return "Other / unspecified";
}
function summarizeTroubleshootingEffectiveness(history: SavedGuidedTest[]) {
  // Compare adjacent chronological worksheets for each camera, never across cameras.
  // A change is attributed to the later worksheet, not inferred from the earlier one.
  const byCamera = new Map<string, SavedGuidedTest[]>();
  for (const item of history) {
    const key = item.cameraId.trim().toLowerCase();
    if (!key) continue;
    byCamera.set(key, [...(byCamera.get(key) || []), item]);
  }
  const totals = new Map<string, TroubleshootingEffectivenessRow>();
  const pairs: Array<{ camera: string; before: SavedGuidedTest; after: SavedGuidedTest; result: string; category: string }> = [];
  for (const entries of byCamera.values()) {
    entries.sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt));
    for (let i = 1; i < entries.length; i++) {
      const before = entries[i - 1]; const after = entries[i];
      const oldStatus = before.steps?.verification?.status;
      const newStatus = after.steps?.verification?.status;
      const category = classifyTroubleshootingChange(after.changeMade || "");
      let result = "inconclusive";
      if ((oldStatus === "pass" || oldStatus === "fail") &&
          (newStatus === "pass" || newStatus === "fail")) {
        result = oldStatus === "fail" && newStatus === "pass" ? "improved" :
          oldStatus === "pass" && newStatus === "fail" ? "regressed" : "unchanged";
      }
      const row = totals.get(category) || { category, comparisons: 0, improved: 0,
        unchanged: 0, regressed: 0, inconclusive: 0 };
      row.comparisons++;
      if (result === "improved") row.improved++;
      else if (result === "regressed") row.regressed++;
      else if (result === "unchanged") row.unchanged++;
      else row.inconclusive++;
      totals.set(category, row);
      pairs.push({ camera: after.cameraId, before, after, result, category });
    }
  }
  return { rows: [...totals.values()].sort((a, b) => b.comparisons - a.comparisons), pairs };
}
function TroubleshootingEffectiveness({ history }: { history: SavedGuidedTest[] }) {
  const { rows, pairs } = useMemo(() => summarizeTroubleshootingEffectiveness(history), [history]);
  function exportSummary() {
    const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(),
      method: "Consecutive saved worksheets for the same camera, compared by operator-reported final verification status",
      categories: rows, comparisons: pairs.map(pair => ({ camera: pair.camera,
        beforeId: pair.before.id, beforeAt: pair.before.savedAt,
        afterId: pair.after.id, afterAt: pair.after.savedAt,
        changeMade: pair.after.changeMade, category: pair.category, result: pair.result })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "troubleshooting-effectiveness.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div>
    <h4>Troubleshooting effectiveness statistics</h4>
    <p>Compares consecutive saved worksheets for the same camera. The later worksheet's
      change description determines the category. Only the manually reported final verification
      result is used to classify improvements or regressions.</p>
    {rows.length ? <><div style={{ overflowX: "auto" }}><table><thead><tr>
      <th>Change category</th><th>Comparisons</th><th>Improved</th><th>Unchanged</th>
      <th>Regressed</th><th>Inconclusive</th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.category}>
      <td>{row.category}</td><td>{row.comparisons}</td><td>{row.improved}</td>
      <td>{row.unchanged}</td><td>{row.regressed}</td><td>{row.inconclusive}</td>
    </tr>)}</tbody></table></div>
    <button type="button" onClick={exportSummary}>Export effectiveness statistics JSON</button>
    <details><summary>Show individual comparisons ({pairs.length})</summary>
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Camera</th><th>Before</th><th>After</th><th>Change</th><th>Result</th>
      </tr></thead><tbody>{pairs.map(pair => <tr key={`${pair.before.id}:${pair.after.id}`}>
        <td>{pair.camera}</td><td>{new Date(pair.before.savedAt).toLocaleString()}</td>
        <td>{new Date(pair.after.savedAt).toLocaleString()}</td>
        <td>{pair.after.changeMade || "Unspecified"}</td><td>{pair.result}</td>
      </tr>)}</tbody></table></div>
    </details></> : <p>Save at least two worksheets for the same camera to see comparisons.</p>}
    <p className="muted">These are operator-reported associations, not measured failure rates or
      proof that a change caused an improvement. Unrecorded intermediate changes, different
      test conditions, and the 30-worksheet retention limit can affect these counts.</p>
  </div>;
}
function GuidedTroubleshootingTests() {
  const [cameraId, setCameraId] = useState("");
  const [operator, setOperator] = useState("");
  const [entries, setEntries] = useState(guidedTestEmpty);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<SavedGuidedTest[]>(readGuidedHistory);
  const [summary, setSummary] = useState("");
  const [changeMade, setChangeMade] = useState("");
  const [comparisonIds, setComparisonIds] = useState<[string, string]>(["", ""]);
  function persistHistory(next: SavedGuidedTest[]) {
    try { localStorage.setItem(GUIDED_HISTORY_KEY, JSON.stringify(next.slice(0, 30)));
      setHistory(next.slice(0, 30)); setNotice("Troubleshooting history saved in this browser."); }
    catch { setNotice("Browser storage unavailable. Export the history JSON instead."); }
  }
  function saveWorksheet() {
    if (!cameraId.trim()) { setNotice("Enter a camera / ring identifier before saving."); return; }
    const saved: SavedGuidedTest = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      savedAt: new Date().toISOString(), cameraId: cameraId.trim(), operator: operator.trim(),
      steps: JSON.parse(JSON.stringify(entries)) as Record<GuidedTestId, GuidedTestEntry>,
      summary: summary.trim(), changeMade: changeMade.trim() };
    persistHistory([saved, ...history]);
  }
  function downloadHistory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1,
      exportedAt: new Date().toISOString(), worksheets: history }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "guided-troubleshooting-history.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importHistory(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { setNotice("History file exceeds 2 MB."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const input = parsed as { worksheets?: unknown };
      if (!input || !Array.isArray(input.worksheets)) throw new Error("Expected a worksheets array.");
      const valid = input.worksheets.filter((item: any) => item && typeof item.id === "string" &&
        typeof item.savedAt === "string" && !Number.isNaN(Date.parse(item.savedAt)) &&
        typeof item.cameraId === "string" && item.cameraId.length <= 120 &&
        typeof item.operator === "string" && item.operator.length <= 120 &&
        typeof item.summary === "string" && item.summary.length <= 3000 &&
        typeof item.changeMade === "string" && item.changeMade.length <= 1000 &&
        item.steps && guidedTestSteps.every(step => item.steps[step.id] &&
          ["not-run", "pass", "fail", "inconclusive"].includes(item.steps[step.id].status) &&
          typeof item.steps[step.id].notes === "string" && item.steps[step.id].notes.length <= 3000));
      if (!valid.length) throw new Error("No valid worksheets in the file.");
      const merged = [...valid, ...history].filter((item, index, all) =>
        all.findIndex(other => other.id === item.id) === index)
        .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).slice(0, 30);
      persistHistory(merged);
    } catch (error) { setNotice(`Import failed: ${String(error)}`); }
  }
  const compare = comparisonIds.map(id => history.find(item => item.id === id));
  function update(id: GuidedTestId, patch: Partial<GuidedTestEntry>) {
    setEntries(current => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
  }
  function exportWorksheet() {
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), cameraId: cameraId.trim(),
      operator: operator.trim(), steps: guidedTestSteps.map(step => ({ ...step, ...entries[step.id] })),
      disclaimer: "Operator-entered results only. No test was automatically run by this worksheet." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `guided-camera-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Worksheet exported. Save it with the matching stress-test and FFmpeg reports.");
  }
  return <section className="session-panel" aria-label="Guided camera troubleshooting tests">
    <h3>Guided camera troubleshooting tests</h3>
    <p>Operator-led isolation checklist. No camera, recording, YouTube stream, or system setting is
      changed by these controls. Run tests only when equipment is not needed for a live event.</p>
    <label>Camera / ring identifier <input value={cameraId} maxLength={120}
      onChange={e => setCameraId(e.target.value)} placeholder="e.g. Ring 3" /></label>{" "}
    <label>Operator <input value={operator} maxLength={120}
      onChange={e => setOperator(e.target.value)} placeholder="Optional" /></label>
    {guidedTestSteps.map(step => <fieldset key={step.id}>
      <legend>{step.title}</legend>
      <ol>{step.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol>
      <label>Result{" "}<select value={entries[step.id].status}
        onChange={e => update(step.id, { status: e.target.value as GuidedTestStatus })}>
        <option value="not-run">Not run</option><option value="pass">Passed (operator verified)</option>
        <option value="fail">Failed (operator verified)</option>
        <option value="inconclusive">Inconclusive</option>
      </select></label>{" "}
      <label>Observations / report filename{" "}<textarea rows={2} maxLength={3000}
        value={entries[step.id].notes} onChange={e => update(step.id, { notes: e.target.value })}
        placeholder="Evidence, timestamps, cable/port, settings, result..." /></label>
    </fieldset>)}
    <p>{guidedTestSteps.filter(step => entries[step.id].status !== "not-run").length} of
      {" "}{guidedTestSteps.length} steps assessed. Results are manual, not verified by the application.</p>
    <label>Change tested / fix applied <input maxLength={1000} value={changeMade}
      onChange={e => setChangeMade(e.target.value)} placeholder="e.g. moved camera to PCIe USB controller" /></label>{" "}
    <label>Outcome summary <textarea maxLength={3000} rows={2} value={summary}
      onChange={e => setSummary(e.target.value)} placeholder="What improved, what remains unresolved?" /></label>
    <button type="button" onClick={saveWorksheet}>Save worksheet to browser history</button>{" "}
    <button type="button" onClick={exportWorksheet}>Export guided test worksheet JSON</button>{" "}
    <button type="button" onClick={() => {
      if (window.confirm("Clear this unsaved troubleshooting worksheet?")) {
        setEntries(guidedTestEmpty()); setCameraId(""); setOperator(""); setSummary(""); setChangeMade(""); setNotice("");
      }
    }}>Clear worksheet</button>
    {notice && <p role="status">{notice}</p>}
    <h4>Saved troubleshooting history</h4>
    <p>Up to 30 worksheets are retained in this browser. Compare two tests for the same camera
      to assess operator-reported changes. This does not measure reliability automatically.</p>
    <button type="button" disabled={!history.length} onClick={downloadHistory}>Export history JSON</button>{" "}
    <label>Import history JSON <input type="file" accept=".json,application/json"
      onChange={e => { void importHistory(e.target.files); e.target.value = ""; }} /></label>
    {history.length ? <div style={{ overflowX: "auto" }}><table><thead><tr>
      <th>Saved</th><th>Camera</th><th>Change tested</th><th>Outcome</th><th>Actions</th>
    </tr></thead><tbody>{history.map(item => <tr key={item.id}>
      <td>{new Date(item.savedAt).toLocaleString()}</td><td>{item.cameraId}</td>
      <td>{item.changeMade || "Not specified"}</td><td>{item.summary || "Not specified"}</td>
      <td><button type="button" onClick={() => { setCameraId(item.cameraId); setOperator(item.operator);
        setEntries(JSON.parse(JSON.stringify(item.steps))); setSummary(item.summary); setChangeMade(item.changeMade);
        setNotice("Worksheet loaded. Save as a new entry after making changes."); }}>Load</button>{" "}
        <button type="button" onClick={() => { if (window.confirm("Delete this saved worksheet?"))
          persistHistory(history.filter(entry => entry.id !== item.id)); }}>Delete</button></td>
    </tr>)}</tbody></table></div> : <p>No saved worksheets yet.</p>}
    <TroubleshootingEffectiveness history={history} />
    {([0, 1] as const).map(index => <label key={index}>Comparison {index === 0 ? "before" : "after"}{" "}
      <select value={comparisonIds[index]} onChange={e => setComparisonIds(current =>
        index === 0 ? [e.target.value, current[1]] : [current[0], e.target.value])}>
        <option value="">Choose worksheet</option>{history.map(item => <option key={item.id} value={item.id}>
          {item.cameraId} / {new Date(item.savedAt).toLocaleString()}</option>)}</select></label>)}
    {compare[0] && compare[1] && <div>
      {compare[0].cameraId !== compare[1].cameraId && <p role="alert">Different cameras selected.
        Results may not be directly comparable.</p>}
      <table><thead><tr><th>Test</th><th>Before</th><th>After</th></tr></thead><tbody>
        {guidedTestSteps.map(step => <tr key={step.id}><td>{step.title}</td>
          <td>{compare[0]!.steps[step.id]?.status || "Missing"}</td>
          <td>{compare[1]!.steps[step.id]?.status || "Missing"}</td></tr>)}
      </tbody></table>
      <p><strong>Before:</strong> {compare[0].summary || "No summary"}</p>
      <p><strong>After:</strong> {compare[1].summary || "No summary"}</p>
      <p>Pass/fail results are manually reported. A change from fail to pass is not proof of a
        permanent fix. Repeat comparable multi-camera stress tests to verify reliability.</p>
    </div>}
    <p className="muted">History is local to this browser and does not synchronize between operator PCs.
      Export regularly for backup. No tests are run or camera settings changed automatically.</p>
  </section>;
}

type ResourceFailureCorrelation = {
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
type CameraTroubleshootingReport = {
  generatedAt: string;
  correlation: UsbRecordingCorrelationReport;
  disconnections: { cameras?: Array<{ cameraId: string; cameraName: string;
    disconnects?: number; completedOutages?: number; totalObservedDowntimeSeconds?: number }> };
  resources: SystemResourceSnapshot;
  limitations: string[];
};
type TimestampedResourceHistory = { readings: Array<SystemResourceSnapshot & { activeCameraIds: string[] }>;
  sampling: { intervalSeconds: number; lastSampleAt: string | null; lastError: string | null }; notes: string[] };
function CameraTroubleshootingPanel({ requestNode }: {
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

type UsbReliabilityThresholds = {
  minimumDisconnects: number; minimumCompletedOutages: number;
  maximumObservedDowntimeSeconds: number; maximumSingleOutageSeconds: number;
};
type UsbReliabilityReport = {
  checkedAt: string; trackedCameras: number; retainedEvents: number; note: string;
  thresholds: UsbReliabilityThresholds;
  warnings: Array<{ cameraId: string; cameraName: string; severity: "critical" | "warning";
    reasons: string[]; currentlyDisconnected: boolean }>;
};
function UsbReliabilityWarningsPanel({ requestNode }: {
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

function ReliabilityWarningsPanel({ requestNode }: {
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

function TournamentReportArchive() {
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

function IncidentTimeline({ nodeId, eventId }: { nodeId: string; eventId: string }) {
  const suffix = `${nodeId}:${eventId || "unsaved"}`;
  const [events, setEvents] = useState<IncidentTimelineEvent[]>([]);
  const [includeWarnings, setIncludeWarnings] = useState(true);
  const [limit, setLimit] = useState(100);
  function refresh() {
    try {
      const alertRaw: unknown = JSON.parse(localStorage.getItem(`tournament-operations-alerts-v1:${suffix}`) || "[]");
      const incidentRaw: unknown = JSON.parse(localStorage.getItem(`tournament-incident-log-v1:${suffix}`) || "[]");
      const alerts: OperationsAlertRecord[] = Array.isArray(alertRaw) ? alertRaw.filter((a): a is OperationsAlertRecord =>
        a !== null && typeof a === "object" && typeof a.key === "string" && typeof a.firstSeen === "string") : [];
      const incidents: IncidentEntry[] = Array.isArray(incidentRaw) ? incidentRaw.filter((e): e is IncidentEntry =>
        e !== null && typeof e === "object" && typeof e.id === "string" && typeof e.timestamp === "string") : [];
      const result: IncidentTimelineEvent[] = [];
      for (const a of alerts) {
        result.push({ id: `alert:${a.key}:${a.firstSeen}:start`, at: a.firstSeen,
          type: "Alert detected", detail: a.message, source: "Alert", severity: a.severity });
        if (a.acknowledgedAt) result.push({ id: `alert:${a.key}:${a.firstSeen}:ack`, at: a.acknowledgedAt,
          type: "Alert acknowledged", detail: a.message, source: "Alert", severity: a.severity });
        if (a.resolvedAt) result.push({ id: `alert:${a.key}:${a.firstSeen}:resolved`, at: a.resolvedAt,
          type: "Alert cleared", detail: a.message, source: "Alert", severity: a.severity });
      }
      for (const e of incidents) {
        const context = [e.ring, e.description].filter(Boolean).join(": ");
        result.push({ id: `incident:${e.id}:start`, at: e.timestamp,
          type: e.autoCreated ? "Automatic incident opened" : "Incident recorded",
          detail: context, source: "Incident" });
        if (e.resolvedAt) result.push({ id: `incident:${e.id}:resolved`, at: e.resolvedAt,
          type: "Incident closed", detail: [context, e.resolution].filter(Boolean).join(" | "), source: "Incident" });
      }
      setEvents(result.filter(e => !Number.isNaN(Date.parse(e.at)))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 1000));
    } catch { setEvents([]); }
  }
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3000);
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", onStorage); };
  }, [suffix]);
  const visible = events.filter(e => includeWarnings || e.severity !== "warning").slice(0, limit);
  function exportTimeline(format: "csv" | "json") {
    const rows = visible.map(e => [e.at, e.source, e.type, e.severity || "", e.detail]);
    const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [["Timestamp", "Source", "Event", "Severity", "Details"], ...rows]
      .map(row => row.map(csvCell).join(",")).join("\r\n");
    const content = format === "csv" ? "\uFEFF" + csv : JSON.stringify({
      nodeId, eventId, exportedAt: new Date().toISOString(), timeline: visible
    }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tournament-incident-timeline-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="session-panel" aria-label="Tournament incident timeline">
    <div className="section-heading"><h3>Incident and alert timeline</h3>
      <span className="muted">{events.length} recorded events</span></div>
    <p className="muted">Chronological view of detected alerts, acknowledgements, alert clearance,
      incident creation, and operator closure. Updated every three seconds from this browser's history.
      Alert clearance does not mean an incident has been closed.</p>
    <div className="field" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
      <label><input type="checkbox" checked={includeWarnings} onChange={e => setIncludeWarnings(e.target.checked)} /> Include warnings</label>
      <label>Show <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
        {[25, 50, 100, 250, 1000].map(n => <option key={n} value={n}>{n} events</option>)}
      </select></label>
      <button type="button" onClick={refresh}>Refresh timeline</button>
      <button type="button" onClick={() => exportTimeline("csv")} disabled={!visible.length}>Export timeline CSV</button>
      <button type="button" onClick={() => exportTimeline("json")} disabled={!visible.length}>Export timeline JSON</button>
    </div>
    {!visible.length ? <p className="muted">No timeline events recorded yet.</p> :
      <div style={{ overflowX: "auto" }}><table><thead><tr>
        <th>Time</th><th>Source</th><th>Event</th><th>Details</th></tr></thead><tbody>
        {visible.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td>
          <td>{e.source}</td><td>{e.type}{e.severity ? ` (${e.severity})` : ""}</td><td>{e.detail}</td>
        </tr>)}</tbody></table></div>}
    <p className="muted">Timeline records are browser-local and are limited by the existing alert and incident history retention.
      They do not synchronize between operator PCs. Export a copy for post-event review.</p>
  </section>;
}

function NodeDashboard({ node }: { node: NodeInfo }) {
  const base = node.local ? "" : `/api/nodes/${encodeURIComponent(node.id)}`;
  const requestNode = (url: string, options?: RequestInit) => {
    if (!node.local && options?.method && options.method.toUpperCase() !== "GET") {
      return Promise.reject(new Error("Remote nodes are read-only in this dashboard. Use the capture node locally to change settings."));
    }
    return request(`${base}${url}`, options);
  };
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<DeviceList>({ cameras: [], microphones: [] });
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [microphones, setMicrophones] = useState<Record<string, string>>(() => savedMicrophones(node.id));
  const [labels, setLabels] = useState<Record<string, string>>(() => savedLabels(node.id));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SizeHistory>({});
  const [now, setNow] = useState(Date.now());
  const [frameTick, setFrameTick] = useState(0);
  const [session, setSession] = useState<TournamentSession>({ eventName: "", assignments: [] });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<Array<{ eventId: string; eventName: string; assignmentCount: number }>>([]);
  const [eventToSelect, setEventToSelect] = useState("");
  const [templates, setTemplates] = useState<Array<{ templateId: string; name: string; eventName: string; assignmentCount: number }>>([]);
  const [templateToLoad, setTemplateToLoad] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  async function refreshTemplates() {
    const result = await requestNode("/api/session/templates");
    setTemplates(result.templates);
  }
  async function saveTemplate() {
    const name = window.prompt("Name this reusable tournament setup template:", session.eventName);
    if (!name?.trim()) return;
    setTemplateBusy(true); setError(null);
    try {
      await requestNode("/api/session/templates", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      await refreshTemplates();
      setBulkResults(["Tournament template saved."]);
    } catch (cause) { setError(String(cause)); }
    finally { setTemplateBusy(false); }
  }
  async function loadTemplate() {
    if (!templateToLoad || !window.confirm("Apply template to the form? This will not change the saved tournament until you save it or create a new tournament ID.")) return;
    setTemplateBusy(true); setError(null);
    try {
      const result = await requestNode(`/api/session/templates/${encodeURIComponent(templateToLoad)}`);
      const template = result.template;
      setSession(old => ({ ...old, eventName: template.eventName,
        assignments: template.assignments.map((a: SessionAssignment) => ({ ...a })) }));
      setPreflight(null);
      setBulkResults(["Template applied to the form. Choose Create New Tournament ID to keep historical events separate."]);
    } catch (cause) { setError(String(cause)); }
    finally { setTemplateBusy(false); }
  }

  // Keep unavailable template devices visible until explicitly reassigned.
  function replaceAssignmentCamera(oldId: string, newId: string) {
    const camera = devices.cameras.find(device => device.id === newId);
    if (!camera || session.assignments.some(a => a.cameraId === newId && a.cameraId !== oldId)) {
      setError("Select an unassigned connected camera."); return;
    }
    setSession(old => ({ ...old, assignments: old.assignments.map(a => a.cameraId === oldId
      ? { ...a, cameraId: camera.id, cameraName: camera.name, microphoneName: microphones[camera.id] || a.microphoneName } : a) }));
    setPreflight(null); setError(null);
  }
  function replaceAssignmentMicrophone(cameraId: string, name: string) {
    if (!devices.microphones.some(m => m.name === name) || session.assignments.some(a => a.cameraId !== cameraId && a.microphoneName === name)) {
      setError("Select an unassigned connected microphone."); return;
    }
    setSession(old => ({ ...old, assignments: old.assignments.map(a => a.cameraId === cameraId ? { ...a, microphoneName: name } : a) }));
    setPreflight(null); setError(null);
  }

  async function refreshEvents() {
    const result = await requestNode("/api/session/events");
    setAvailableEvents(result.events);
    setEventToSelect((previous) => previous || result.selectedEventId || "");
  }
  async function selectSavedTournament() {
    if (!eventToSelect || eventToSelect === session.eventId) return;
    if (!window.confirm("Load this tournament's saved name and ring assignments? Unsaved changes to the current form will be lost.")) return;
    setSessionBusy(true); setError(null);
    try {
      const result = await requestNode("/api/session/select-event", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: eventToSelect })
      });
      setSession(result.session);
      setPreflight(null);
      setBulkResults([`Loaded tournament: ${result.session.eventName}`]);
      await refreshEvents();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  const [bulkResults, setBulkResults] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [readiness, setReadiness] = useState<TournamentReadiness | null>(null);
  const [equipmentTests, setEquipmentTests] = useState<Record<string, EquipmentTestResult>>({});
  const [encoderStats, setEncoderStats] = useState<EncoderStatsSnapshot | null>(null);
  const [encoderStatsError, setEncoderStatsError] = useState<string | null>(null);
  const [encoderStatsBusy, setEncoderStatsBusy] = useState(false);
  async function refreshEncoderStats() {
    setEncoderStatsBusy(true);
    try {
      const result = await requestNode("/api/captures/encoder-stats") as EncoderStatsSnapshot;
      setEncoderStats(result); setEncoderStatsError(null);
    } catch (error) { setEncoderStatsError(String(error)); }
    finally { setEncoderStatsBusy(false); }
  }
  const [stressBusy, setStressBusy] = useState(false);
  const [stressProgress, setStressProgress] = useState(0);
  const [stressResults, setStressResults] = useState<StressResult[] | null>(null);
  const [stressError, setStressError] = useState<string | null>(null);
  const [stressResources, setStressResources] = useState<StressResourceReport | null>(null);
  function exportStressReport(format: "json" | "csv") {
    if (!stressResults || !stressResources || stressBusy) return;
    const report = {
      schemaVersion: 1,
      test: "30-second multi-camera recording pipeline stress test",
      exportedAt: new Date().toISOString(),
      startedAt: stressResources.startedAt,
      endedAt: stressResources.endedAt,
      resourceSampleFailures: stressResources.failures,
      cameraResults: stressResults,
      resourceReadings: stressResources.readings,
      limitations: [
        "Observed FPS is preview sampling rate, not encoded recording FPS.",
        "GPU utilization is device-wide, not NVENC-specific.",
        "Disk counters are system-wide; readings are approximate.",
        "The test does not directly measure USB bandwidth or establish root cause."
      ]
    };
    const csvEscape = (value: unknown): string => {
      const string = value === null || value === undefined ? "" : String(value);
      return `"${string.replace(/"/g, '""')}"`;
    };
    let contents: string;
    let mime: string;
    if (format === "json") {
      contents = JSON.stringify(report, null, 2) + "\n";
      mime = "application/json";
    } else {
      const headers = ["recordType", "timestamp", "cameraId", "cameraName", "status",
        "observedPreviewFps", "growthBytes", "staleSamples", "missingSamples", "restarted",
        "cpuPercent", "ramUsedBytes", "gpuPercent", "gpuMemoryUsedMiB", "diskWriteBytesPerSec",
        "diskBusyPercent", "resourceSampleFailures"];
      const rows: unknown[][] = [headers];
      for (const result of stressResults) rows.push([
        "camera", stressResources.endedAt, result.cameraId, result.cameraName, result.status,
        result.observedFps, result.growthBytes, result.staleSamples, result.missingSamples,
        result.restarted, "", "", "", "", "", "", stressResources.failures
      ]);
      for (const reading of stressResources.readings) rows.push([
        "resource", reading.checkedAt, "", "", "", "", "", "", "", "",
        reading.cpu.utilizationPercent, reading.memory.usedBytes,
        reading.gpu?.utilizationPercent, reading.gpu?.memoryUsedMiB,
        reading.disk.writeBytesPerSec, reading.disk.busyPercent, stressResources.failures
      ]);
      contents = "\uFEFF" + rows.map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
      mime = "text/csv;charset=utf-8";
    }
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tournament-stress-${stressResources.startedAt.replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  type ImportedStressReport = {
    schemaVersion: number; startedAt: string; endedAt: string;
    cameraResults: StressResult[];
    resourceReadings: SystemResourceSnapshot[];
  };
  type SavedStressReport = { id: string; label: string; filename: string; report: ImportedStressReport };
  const historyKey = "tournament-stress-history-v1";
  const [savedStressReports, setSavedStressReports] = useState<SavedStressReport[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter((entry): entry is SavedStressReport =>
        !!entry && typeof entry.id === "string" && typeof entry.label === "string" &&
        typeof entry.filename === "string" && !!entry.report &&
        entry.report.schemaVersion === 1 && Array.isArray(entry.report.cameraResults) &&
        Array.isArray(entry.report.resourceReadings)).slice(-30);
    } catch { return []; }
  });
  const [historyLabel, setHistoryLabel] = useState("");
  const [historyError, setHistoryError] = useState("");
  function updateStressHistory(change: (previous: SavedStressReport[]) => SavedStressReport[]) {
    setSavedStressReports(previous => {
      const next = change(previous).slice(-30);
      try { localStorage.setItem(historyKey, JSON.stringify(next)); setHistoryError(""); }
      catch { setHistoryError("Browser storage is full or unavailable. Export JSON to keep a permanent copy."); }
      return next;
    });
  }
  function saveStressHistory(report: ImportedStressReport, label: string, filename: string) {
    const entry: SavedStressReport = {
      id: `${report.startedAt}-${Math.random().toString(36).slice(2, 10)}`,
      label: label.trim().slice(0, 100) || `Stress test ${new Date(report.startedAt).toLocaleString()}`,
      filename, report
    };
    updateStressHistory(previous => [...previous, entry]);
  }
  const [comparisonReports, setComparisonReports] = useState<Array<{ filename: string; report: ImportedStressReport }>>([]);
  const [comparisonError, setComparisonError] = useState("");
  async function importStressReports(files: FileList | null) {
    if (!files?.length) return;
    setComparisonError("");
    const imported: Array<{ filename: string; report: ImportedStressReport }> = [];
    for (const file of Array.from(files).slice(0, 12)) {
      try {
        if (file.size > 5_000_000) throw new Error("file exceeds 5 MB");
        const value: unknown = JSON.parse(await file.text());
        if (!value || typeof value !== "object") throw new Error("not a report object");
        const report = value as Partial<ImportedStressReport>;
        if (report.schemaVersion !== 1 || typeof report.startedAt !== "string" ||
            typeof report.endedAt !== "string" || !Array.isArray(report.cameraResults) ||
            !Array.isArray(report.resourceReadings) ||
            report.cameraResults.length > 100 || report.resourceReadings.length > 500 ||
            !report.cameraResults.every(camera => camera && typeof camera.cameraId === "string" &&
              typeof camera.cameraName === "string" && ["pass", "warning", "failed"].includes(camera.status) &&
              typeof camera.observedFps === "number" && Number.isFinite(camera.observedFps))) {
          throw new Error("invalid or unsupported milestone 43 JSON report");
        }
        imported.push({ filename: file.name, report: report as ImportedStressReport });
      } catch (error) { setComparisonError(previous => previous + `${file.name}: ${String(error)}\n`); }
    }
    setComparisonReports(previous => [...previous, ...imported].slice(-12));
    if (imported.length) updateStressHistory(previous => [...previous, ...imported.map(({ filename, report }) => ({
      id: `${report.startedAt}-${Math.random().toString(36).slice(2, 10)}`,
      label: filename.replace(/\.json$/i, "").slice(0, 100), filename, report
    }))]);
  }
  function summarizeComparison(report: ImportedStressReport) {
    const count = report.cameraResults.length;
    const passes = report.cameraResults.filter(camera => camera.status === "pass").length;
    const warnings = report.cameraResults.filter(camera => camera.status === "warning").length;
    const failed = report.cameraResults.filter(camera => camera.status === "failed").length;
    const averagePreviewFps = count ? report.cameraResults.reduce((sum, camera) => sum + camera.observedFps, 0) / count : null;
    const cpu = report.resourceReadings.map(reading => reading.cpu?.utilizationPercent).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const gpu = report.resourceReadings.map(reading => reading.gpu?.utilizationPercent).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const disk = report.resourceReadings.map(reading => reading.disk?.writeBytesPerSec).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return { count, passes, warnings, failed, averagePreviewFps, cpu: average(cpu), gpu: average(gpu), disk: average(disk) };
  }
  const [equipmentTesting, setEquipmentTesting] = useState<string | null>(null);
  const [equipmentTestError, setEquipmentTestError] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessDraft, setReadinessDraft] = useState<string | null>(null);
  const [preflightDraft, setPreflightDraft] = useState<string | null>(null);
  const [youtubeStreams, setYoutubeStreams] = useState<YouTubeStream[]>([]);
  const [recordingEvents, setRecordingEvents] = useState<RecordingEvent[]>([]);
  const [pastSessions, setPastSessions] = useState<Array<{
    cameraId: string; cameraName: string; recordingPath: string; startedAt: string; endedAt?: string;
    eventId?: string; eventName?: string; ring?: string;
    outcome: string; integrity: { status: string; issues: string[]; segments: Array<{name: string; bytes: number}>; totalBytes?: number };
  }>>([]);
  const [validationResults, setValidationResults] = useState<Record<string, {status: string; issues: string[]; checked: number; total: number}>>({});
  const [validationBusy, setValidationBusy] = useState(false);
  async function validateSession(recordingPath: string) {
    setValidationBusy(true);
    try {
      const result = await requestNode("/api/recording-history/validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingPath })
      });
      setValidationResults(previous => ({ ...previous, [recordingPath]: result }));
    } catch (error) { setPastSessionsError(String(error)); }
    finally { setValidationBusy(false); }
  }
  const [pastSessionsError, setPastSessionsError] = useState("");
  const [pastSessionsLoading, setPastSessionsLoading] = useState(false);
  const [recordingSummary, setRecordingSummary] = useState<RecordingSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  async function runCameraStressTest() {
    setStressBusy(true); setStressProgress(0); setStressResults(null); setStressError(null); setStressResources(null);
    try {
      const samples: StressSnapshot[] = [];
      const readings: SystemResourceSnapshot[] = [];
      let resourceFailures = 0;
      const sampleResources = async () => {
        try { readings.push(await requestNode("/api/system/resources") as SystemResourceSnapshot); }
        catch { resourceFailures++; }
      };
      // 30 seconds of actual simultaneous recording, without touching stream state.
      const first = await requestNode("/api/captures/stress-snapshot") as StressSnapshot;
      if (first.captures.length < 2) throw new Error("Start recordings on at least two cameras before running the stress test.");
      samples.push(first);
      const resourceStart = new Date().toISOString();
      await sampleResources();
      const started = Date.now();
      for (let second = 1; second <= 30; second++) {
        const wait = Math.max(0, started + second * 1000 - Date.now());
        await new Promise<void>(resolve => window.setTimeout(resolve, wait));
        // Collect OS metrics every 5 seconds. Failure never aborts the camera test.
        const [capture] = await Promise.all([
          requestNode("/api/captures/stress-snapshot") as Promise<StressSnapshot>,
          second % 5 === 0 ? sampleResources() : Promise.resolve()
        ]);
        samples.push(capture);
        setStressProgress(second);
      }
      const last = samples[samples.length - 1];
      const elapsed = Math.max(1, (last.checkedAt - first.checkedAt) / 1000);
      const results: StressResult[] = first.captures.map(initial => {
        const seen = samples.map(sample => sample.captures.find(item => item.cameraId === initial.cameraId));
        const ending = seen[seen.length - 1];
        const missingSamples = seen.filter(item => !item || !item.running).length;
        const restarted = seen.some(item => item && item.startedAt !== initial.startedAt);
        const staleSamples = seen.filter(item => item && (item.frameAgeMs === null || item.frameAgeMs > 3000)).length;
        const observedFps = ending && !restarted && ending.frameCount >= initial.frameCount
          ? (ending.frameCount - initial.frameCount) / elapsed : 0;
        const growthBytes = ending && ending.recordingBytes !== null && initial.recordingBytes !== null &&
          !restarted ? ending.recordingBytes - initial.recordingBytes : null;
        const status = missingSamples || restarted || !ending ? "failed" :
          staleSamples > 2 || observedFps < 3 || growthBytes === null || growthBytes <= 0 ? "warning" : "pass";
        return { cameraId: initial.cameraId, cameraName: initial.cameraName,
          sampleCount: seen.length, observedFps, growthBytes, staleSamples, missingSamples,
          restarted, status };
      });
      const extra = last.captures.filter(item => !first.captures.some(old => old.cameraId === item.cameraId));
      if (extra.length) setStressError(`Additional recordings started during the test: ${extra.map(item => item.cameraName).join(", ")}. Rerun for a consistent baseline.`);
      setStressResults(results);
      const resourceEnd = new Date().toISOString();
      setStressResources({ readings, failures: resourceFailures,
        startedAt: resourceStart, endedAt: resourceEnd });
      saveStressHistory({ schemaVersion: 1, startedAt: resourceStart, endedAt: resourceEnd,
        cameraResults: results, resourceReadings: readings },
        historyLabel || `Automatic test ${new Date(resourceStart).toLocaleString()}`,
        `tournament-stress-${resourceStart.replace(/[:.]/g, "-")}.json`);
    } catch (cause) { setStressError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStressBusy(false); }
  }

  async function testRingEquipment(assignment: SessionAssignment) {
    setEquipmentTesting(assignment.cameraId);
    setEquipmentTestError(null);
    try {
      const result: EquipmentTestResult = await requestNode("/api/device-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId: assignment.cameraId, microphoneName: assignment.microphoneName })
      });
      setEquipmentTests(previous => ({ ...previous, [assignment.cameraId]: result }));
    } catch (error) { setEquipmentTestError(String(error)); }
    finally { setEquipmentTesting(null); }
  }

  async function checkTournamentReadiness() {
    setReadinessBusy(true);
    setReadinessError(null);
    const draft = JSON.stringify(session);
    try {
      const [preflightResult, cameraData, captureData, captureHealthData, streamData, diskResult] = await Promise.all([
        requestNode("/api/session/preflight", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: draft
        }) as Promise<PreflightResult>,
        requestNode("/api/devices") as Promise<DeviceList>,
        requestNode("/api/captures") as Promise<{ captures: Capture[] }>,
        requestNode("/api/captures/health") as Promise<{ captures: CaptureHealth[] }>,
        requestNode("/api/youtube/streams") as Promise<{ streams: YouTubeStream[] }>,
        requestNode("/api/storage/health").then((storage: StorageHealth) =>
          ({ storage, error: null as string | null }),
          (error: unknown) => ({ storage: null as StorageHealth | null, error: String(error) }))
      ]);
      const blockers = preflightResult.checks.filter(item => item.level === "error").map(item => item.message);
      const warnings = preflightResult.checks.filter(item => item.level === "warning").map(item => item.message);
      if (diskResult.error) blockers.push(`Storage check unavailable: ${diskResult.error}`);
      if (diskResult.storage?.status === "critical") blockers.push("Recording disk below critical threshold.");
      const rings = session.assignments.map(assignment => {
        const capture = captureData.captures.find(item => item.cameraId === assignment.cameraId);
        const health = captureHealthData.captures.find(item => item.cameraId === assignment.cameraId);
        const stream = streamData.streams.find(item => item.cameraId === assignment.cameraId);
        const cameraConnected = cameraData.cameras.some(item => item.id === assignment.cameraId);
        const microphoneConnected = cameraData.microphones.some(item => item.name === assignment.microphoneName);
        const issues = [
          ...(!cameraConnected ? ["Camera disconnected"] : []),
          ...(!microphoneConnected ? ["Microphone disconnected"] : []),
          ...(health?.status === "warning" ? health.warnings : []),
          ...(stream?.status === "error" ? ["YouTube relay error"] : [])
        ];
        if (health?.status === "warning") warnings.push(`${assignment.ring}: recording health warning.`);
        if (stream?.status === "error") warnings.push(`${assignment.ring}: YouTube relay error.`);
        return { ring: assignment.ring, camera: assignment.cameraName, cameraConnected,
          microphoneConnected, recording: !!capture?.running,
          recordingHealthy: health ? health.status === "healthy" : null,
          youtubeLive: stream?.status === "live", issues };
      });
      setReadiness({ checkedAt: new Date().toISOString(), preflight: preflightResult,
        storage: diskResult.storage, storageError: diskResult.error, rings, blockers, warnings });
      setReadinessDraft(draft);
    } catch (cause) { setReadiness(null); setReadinessError(String(cause)); }
    finally { setReadinessBusy(false); }
  }

  async function refreshRecordingSummary() {
    setSummaryBusy(true);
    try {
      setRecordingSummary(await requestNode(`/api/recording-history/summary${selectedEventId ? `?eventId=${encodeURIComponent(selectedEventId)}` : ""}`));
      setSummaryError("");
    } catch (error) { setSummaryError(String(error)); }
    finally { setSummaryBusy(false); }
  }

  const [reportBusy, setReportBusy] = useState(false);
  async function downloadRecordingReport(format: "csv" | "json") {
    if (!node.local) { setPastSessionsError("Download reports from the capture node's local dashboard."); return; }
    setReportBusy(true);
    try {
      const headers = new Headers();
      if (operatorToken) headers.set("Authorization", `Bearer ${operatorToken}`);
      const response = await fetch(`/api/recording-history/report?format=${format}`, { headers });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Report download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.href = url;
      link.download = `tournament-recording-report-${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setPastSessionsError("");
    } catch (cause) { setPastSessionsError(String(cause)); }
    finally { setReportBusy(false); }
  }

  async function refreshPastSessions() {
    setPastSessionsLoading(true);
    try {
      const data = await requestNode("/api/recording-history?limit=50");
      setPastSessions(data.sessions);
      setPastSessionsError("");
    } catch (cause) { setPastSessionsError(String(cause)); }
    finally { setPastSessionsLoading(false); }
  }

  const [captureHealth, setCaptureHealth] = useState<CaptureHealth[]>([]);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [streamKeys, setStreamKeys] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [keyImportFile, setKeyImportFile] = useState<File | null>(null);
  const [keyImportBusy, setKeyImportBusy] = useState(false);
  const [keyImportMessage, setKeyImportMessage] = useState("");

  useEffect(() => { localStorage.setItem(`tournament-camera-labels-${node.id}`, JSON.stringify(labels)); }, [labels]);
  useEffect(() => { localStorage.setItem(`tournament-camera-microphones-${node.id}`, JSON.stringify(microphones)); }, [microphones]);

  async function refreshDevices() {
    setDevicesLoading(true);
    try {
      const result: DeviceList = await requestNode("/api/devices");
      setDevices(result);
      setMicrophones((previous) => {
        const updated: Record<string, string> = {};
        // Never guess pairings from enumeration order: identical USB cameras can reorder.
        for (const camera of result.cameras) {
          const previousMic = previous[camera.id];
          updated[camera.id] = previousMic && result.microphones.some((m) => m.name === previousMic)
            ? previousMic : "";
        }
        return updated;
      });
    } catch (cause) { setError(String(cause)); }
    finally { setDevicesLoading(false); }
  }

  useEffect(() => {
    void refreshDevices();
    void requestNode("/api/recording-events").then((data: { events: RecordingEvent[] }) => setRecordingEvents(data.events)).catch(() => {});
    void refreshYouTubeProfiles();
    if (node.local) void requestNode("/api/settings")
      .then((data: {settings: AppSettings}) => setSettings(data.settings))
      .catch((cause) => setError(String(cause)));
    if (node.local) void requestNode("/api/network/status")
      .then((data: NetworkStatus) => setNetworkStatus(data))
      .catch(() => setNetworkStatus(null));
    void refreshEvents().catch(() => {});
    void requestNode("/api/session").then((data: { session: TournamentSession | null }) => {
      if (data.session) setSession(data.session);
    }).catch((cause) => setError(String(cause)));
  }, []);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [captureData, previewData, youtubeData, healthData] = await Promise.all([
          requestNode("/api/captures"), requestNode("/api/previews"), requestNode("/api/youtube/streams"), requestNode("/api/captures/health")
        ]);
        if (!active) return;
        const nextCaptures = captureData.captures as Capture[];
        setCaptures(nextCaptures);
        setPreviews(previewData.previews as Preview[]);
        setYoutubeStreams(youtubeData.streams as YouTubeStream[]);
        setCaptureHealth(healthData.captures as CaptureHealth[]);
        void requestNode("/api/storage/health")
          .then((data: StorageHealth) => { if (active) { setStorageHealth(data); setStorageError(null); } })
          .catch((cause) => { if (active) { setStorageHealth(null); setStorageError(String(cause)); } });
        void requestNode("/api/recording-events").then((data: { events: RecordingEvent[] }) => {
          if (active) setRecordingEvents(data.events);
        }).catch(() => {});
        setConnected(true);
        const timestamp = Date.now();
        setHistory((previous) => {
          const next: SizeHistory = {};
          for (const capture of nextCaptures) {
            if (capture.recordingFileSize === null) continue;
            const old = previous[capture.cameraId];
            next[capture.cameraId] = !old || old.startedAt !== capture.startedAt ||
              capture.recordingFileSize > old.size
              ? { size: capture.recordingFileSize, lastGrowthAt: timestamp, startedAt: capture.startedAt }
              : { ...old, size: capture.recordingFileSize };
          }
          return next;
        });
      } catch {
        if (active) setConnected(false);
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 2000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  const hasActiveVideo = captures.some((capture) => capture.running) ||
    previews.some((preview) => preview.status === "running" || preview.status === "starting");
  useEffect(() => {
    if (!hasActiveVideo) return;
    const interval = window.setInterval(() => setFrameTick((tick) => tick + 1), 200);
    return () => window.clearInterval(interval);
  }, [hasActiveVideo]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function perform(cameraId: string, action: () => Promise<void>) {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    if (busyIds.includes(cameraId)) return;
    setBusyIds((old) => [...old, cameraId]);
    setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyIds((old) => old.filter((id) => id !== cameraId)); }
  }
  async function togglePreview(camera: MediaDevice, active: boolean) {
    await perform(camera.id, async () => {
      if (active) {
        await requestNode(`/api/previews/${encodeURIComponent(camera.id)}/stop`, { method: "POST" });
        setPreviews((old) => old.filter((preview) => preview.cameraId !== camera.id));
      } else {
        await requestNode("/api/previews/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraId: camera.id, cameraName: camera.name })
        });
        const data = await requestNode("/api/previews");
        setPreviews(data.previews);
      }
    });
  }
  async function recoverRecording(camera: MediaDevice) {
    if (!window.confirm(`Restart recording for ${labelFor(camera.id, camera.name)}? This finalizes the current file and stops YouTube streaming until manually restarted. Recovery is limited to twice per hour per camera, with a 5-minute cooldown.`)) return;
    await perform(camera.id, async () => {
      const result = await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/recover`, { method: "POST" });
      setBulkResults([`${labelFor(camera.id, camera.name)}: ${result.message}`]);
      const [captureData, streamData] = await Promise.all([
        requestNode("/api/captures"), requestNode("/api/youtube/streams")
      ]);
      setCaptures(captureData.captures);
      setYoutubeStreams(streamData.streams);
    });
  }

  async function toggleRecording(camera: MediaDevice, capture?: Capture) {
    await perform(camera.id, async () => {
      if (capture) {
        await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/stop`, { method: "POST" });
      } else {
        const microphoneId = settings?.devices[camera.id]?.pairedMicrophoneId;
        const microphoneName = microphoneId ? devices.microphones.find(m => m.id === microphoneId)?.name : microphones[camera.id];
        if (!microphoneName) throw new Error(`Assign a microphone to ${camera.name} first.`);
        if (captures.some((item) => item.microphoneName === microphoneName)) {
          throw new Error(`Microphone already in use: ${microphoneName}`);
        }
        await requestNode("/api/captures/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraId: camera.id, cameraName: camera.name,
            cameraDeviceId: camera.id, microphoneName, microphoneId
          })
        });
      }
      const data = await requestNode("/api/captures");
      setCaptures(data.captures);
      if (capture) setYoutubeStreams((old) => old.filter((stream) => stream.cameraId !== camera.id));
    });
  }

  async function refreshYouTubeProfiles() {
    try {
      const result = await requestNode("/api/youtube/profiles");
      setSavedProfiles(Object.fromEntries((result.profiles as { cameraId: string; label: string }[]).map(p => [p.cameraId, p.label])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function saveYouTubeKey(camera: MediaDevice) {
    const streamKey = streamKeys[camera.id]?.trim();
    if (!streamKey) { setError("Enter a stream key before saving."); return; }
    try {
      await requestNode(`/api/youtube/profiles/${encodeURIComponent(camera.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelFor(camera.id, camera.name), streamKey })
      });
      setStreamKeys(old => ({ ...old, [camera.id]: "" }));
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function downloadYouTubeTemplate() {
    const payload = { format: "tournament-youtube-keys-v1", profiles: devices.cameras.map(camera => ({
      cameraId: camera.id, label: labelFor(camera.id, camera.name), streamKey: ""
    })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "youtube-keys-template.json";
    anchor.click(); URL.revokeObjectURL(url);
  }

  async function importYouTubeKeys() {
    if (!node.local || !keyImportFile) return;
    if (!window.confirm("Import stream keys from this file? Matching saved keys will be replaced. Treat the source file as sensitive and delete it securely when finished.")) return;
    setKeyImportBusy(true); setKeyImportMessage(""); setError(null);
    try {
      if (keyImportFile.size > 128 * 1024) throw new Error("Import file is too large (128 KiB maximum).");
      const payload = JSON.parse(await keyImportFile.text());
      const result = await requestNode("/api/youtube/profiles/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      setKeyImportMessage(`Imported ${result.imported} stream profiles. ${result.total} saved on this computer.`);
      setKeyImportFile(null);
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setKeyImportBusy(false); }
  }

  async function deleteYouTubeKey(cameraId: string) {
    if (!window.confirm("Remove the saved YouTube stream key for this camera?")) return;
    try {
      await requestNode(`/api/youtube/profiles/${encodeURIComponent(cameraId)}`, { method: "DELETE" });
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function toggleYouTube(cameraId: string, active: boolean) {
    await perform(cameraId, async () => {
      if (active) {
        await requestNode(`/api/youtube/${encodeURIComponent(cameraId)}/stop`, { method: "POST" });
      } else {
        const streamKey = streamKeys[cameraId]?.trim();
        if (!streamKey && !savedProfiles[cameraId]) throw new Error("Enter a stream key or save a profile first.");
        await requestNode(`/api/youtube/${encodeURIComponent(cameraId)}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(streamKey ? { streamKey } : {})
        });
        setStreamKeys((old) => ({ ...old, [cameraId]: "" }));
      }
      const data = await requestNode("/api/youtube/streams");
      setYoutubeStreams(data.streams);
    });
  }

  async function createNewTournament() {
    if (!window.confirm("Create a new tournament ID? Historical recordings will stay linked to the previous tournament, even if you reuse its name.")) return;
    setSessionBusy(true); setError(null);
    try {
      const result = await requestNode("/api/session/new-event", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(session)
      });
      setSession(result.session);
      setEventToSelect(result.session.eventId || "");
      await refreshEvents();
      setBulkResults(["New tournament created. Permanent ID: " + result.session.eventId]);
    } catch (cause) { setError(String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function saveSession() {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    setSessionBusy(true); setError(null);
    try {
      const result: { session: TournamentSession } = await requestNode("/api/session", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session)
      });
      setSession(result.session);
      setEventToSelect(result.session.eventId || "");
      await refreshEvents();
      setBulkResults(["Session saved."]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function runPreflight() {
    setPreflightBusy(true); setError(null);
    try {
      setPreflightDraft(JSON.stringify(session));
      setPreflight(await requestNode("/api/session/preflight", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session)
      }) as PreflightResult);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPreflightBusy(false); }
  }

  async function bulkAction(action: "start-all" | "stop-all") {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    if (action === "stop-all" && !window.confirm(`Stop all recordings on ${node.name}?`)) return;
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    setSessionBusy(true); setError(null);
    try {
      const result: { results: { cameraId: string; ok: boolean; error?: string }[] } =
        await requestNode(`/api/session/${action}`, { method: "POST" });
      setBulkResults(result.results.map((item) => {
        const name = session.assignments.find((assignment) => assignment.cameraId === item.cameraId)?.ring ??
          item.cameraId;
        return `${name}: ${item.ok ? "OK" : item.error ?? "Failed"}`;
      }));
      const capturesData = await requestNode("/api/captures");
      setCaptures(capturesData.captures);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function bulkYouTube(action: "start-all" | "stop-all") {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    if (action === "start-all" && !window.confirm("Start YouTube streams for all assigned rings with active recordings and saved stream keys?")) return;
    if (action === "stop-all" && !window.confirm("Stop all YouTube streams on this node? Local recordings will continue.")) return;
    setSessionBusy(true); setError(null);
    try {
      const result = await requestNode(`/api/youtube/${action}`, { method: "POST" });
      if (action === "start-all") {
        setBulkResults((result.results as { cameraId: string; ok: boolean; error?: string }[]).map(item => {
          const ring = session.assignments.find(a => a.cameraId === item.cameraId)?.ring ?? item.cameraId;
          return `${ring}: ${item.ok ? "YouTube relay started or already active" : item.error ?? "Failed"}`;
        }));
      } else {
        setBulkResults(["All YouTube relays stopped. Local recordings continue."]);
      }
      const status = await requestNode("/api/youtube/streams");
      setYoutubeStreams(status.streams);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  const activeRecordings = captures.filter((capture) => capture.running);
  const unhealthy = activeRecordings.filter((capture) =>
    capture.previewFrozen || (history[capture.cameraId] &&
      now - history[capture.cameraId].lastGrowthAt > 10000));
  const healthy = activeRecordings.filter((capture) =>
    !capture.previewFrozen && history[capture.cameraId] &&
    now - history[capture.cameraId].lastGrowthAt <= 10000).length;
  const labelFor = (cameraId: string, name: string) =>
    settings?.devices[cameraId]?.alias?.trim() || labels[cameraId]?.trim() ||
    devices.allDevices?.find((d) => d.id === cameraId)?.displayName || name;
  const visibleCameras = devices.cameras.filter((camera) => settings?.devices[camera.id]?.hidden !== true);
  const allDevices = devices.allDevices ?? [...devices.cameras, ...devices.microphones];
  const editDevice = (id: string, patch: DevicePreference) => setSettings((previous) => previous ? ({
    ...previous, devices: { ...previous.devices, [id]: { ...previous.devices[id], ...patch } }
  }) : previous);
  async function saveSettings() {
    if (!settings || !node.local) return;
    setSettingsBusy(true); setSettingsMessage("");
    try {
      const result: {settings: AppSettings; restartRequired: boolean} = await requestNode("/api/settings", {
        method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(settings)
      });
      setSettings(result.settings);
      setSettingsMessage("Settings saved. Restart the backend if you changed network mode or bind address.");
      await refreshDevices();
    } catch (cause) { setError(String(cause)); }
    finally { setSettingsBusy(false); }
  }
  async function downloadBackup() {
    try {
      const data = await requestNode("/api/config/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = "tournament-backup.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(String(cause)); }
  }
  async function restoreBackup() {
    if (!restoreFile || !window.confirm("Restore this configuration? Existing settings and session assignments will be replaced.")) return;
    setSettingsBusy(true);
    try {
      const backup = JSON.parse(await restoreFile.text());
      const result = await requestNode("/api/config/restore", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(backup) });
      setSettings(result.settings); setSession(result.session);
      setSettingsMessage("Backup restored. Restart the backend for network changes.");
      await refreshDevices();
    } catch (cause) { setError(String(cause)); }
    finally { setSettingsBusy(false); }
  }

  const [relayStaleSeconds, setRelayStaleSeconds] = useState<number>(() => {
    try { const value = Number(localStorage.getItem(`tournament-relay-stale-v1:${node.id}`));
      return [15, 30, 60, 120].includes(value) ? value : 30; } catch { return 30; }
  });
  useEffect(() => {
    try { localStorage.setItem(`tournament-relay-stale-v1:${node.id}`, String(relayStaleSeconds)); }
    catch { /* storage unavailable */ }
  }, [node.id, relayStaleSeconds]);
  // Poll the capture node's persisted USB connection history, rather than relying
  // on browser-local estimates. Fetch failure must not clear previously known alerts.
  const [usbConnectionWarnings, setUsbConnectionWarnings] = useState<Array<{
    cameraId: string; cameraName: string; severity: OperationsAlertSeverity;
    reasons: string[]; currentlyDisconnected: boolean;
  }>>([]);
  const [usbWarningsReady, setUsbWarningsReady] = useState(false);
  const [usbWarningsError, setUsbWarningsError] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result: { warnings: Array<{ cameraId: string; cameraName: string;
          severity: OperationsAlertSeverity; reasons: string[]; currentlyDisconnected: boolean }> } =
          await requestNode("/api/camera-health/usb-warnings");
        if (!mounted) return;
        setUsbConnectionWarnings(Array.isArray(result.warnings) ? result.warnings : []);
        setUsbWarningsReady(true);
        setUsbWarningsError("");
      } catch (cause) {
        if (mounted) setUsbWarningsError(String(cause));
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [node.id]);
  const operationsAlerts: OperationsAlertInput[] = [];
  // Stable per-camera keys ensure existing acknowledgement, resolution, audible
  // alerts and automatic critical incident creation work without duplicate spam.
  for (const warning of usbConnectionWarnings) {
    if (!warning.cameraId || !Array.isArray(warning.reasons)) continue;
    operationsAlerts.push({
      key: `usb-reliability:${warning.cameraId}`,
      severity: warning.severity === "critical" ? "critical" : "warning",
      message: `${warning.cameraName || warning.cameraId}: USB connection reliability: ${warning.reasons.join("; ")}`
    });
  }
  if (!connected) operationsAlerts.push({ key: "node-disconnected", severity: "critical", message: "Node API disconnected" });
  if (storageHealth?.status === "critical") operationsAlerts.push({ key: "storage-critical", severity: "critical",
    message: `Recording storage critical: ${fileSize(storageHealth.freeBytes)} remaining` });
  if (storageHealth?.status === "warning") operationsAlerts.push({ key: "storage-warning", severity: "warning",
    message: `Recording storage low: ${fileSize(storageHealth.freeBytes)} remaining` });
  if (storageError) operationsAlerts.push({ key: "storage-unavailable", severity: "warning", message: `Storage status unavailable: ${storageError}` });
  for (const assignment of session.assignments) {
    const id = assignment.cameraId;
    const ring = assignment.ring;
    const capture = captures.find(c => c.cameraId === id);
    const health = captureHealth.find(h => h.cameraId === id);
    const stream = youtubeStreams.find(y => y.cameraId === id);
    if (!devices.cameras.some(d => d.id === id)) operationsAlerts.push({ key: `camera-missing:${id}`, severity: "critical", message: `${ring}: camera not detected` });
    if (health?.status === "warning") operationsAlerts.push({ key: `recording-warning:${id}`, severity: "warning", message: `${ring}: ${health.warnings.join("; ") || "recording warning"}` });
    if (capture?.previewFrozen) operationsAlerts.push({ key: `preview-frozen:${id}`, severity: "warning", message: `${ring}: preview frozen` });
    if (stream?.status === "error") operationsAlerts.push({ key: `relay-error:${id}`, severity: "critical", message: `${ring}: ${stream.error || "YouTube relay error"}` });
    if (stream?.status === "live" && typeof stream.progressAgeMs === "number" &&
        stream.progressAgeMs > relayStaleSeconds * 1000)
      operationsAlerts.push({ key: `relay-stalled:${id}`, severity: "warning",
        message: `${ring}: YouTube relay progress stale (${Math.round(stream.progressAgeMs / 1000)}s)` });
  }

  return (
    <section className="node-panel" aria-label={`${node.name} cameras`}>
      <header className="dashboard-header">
        <div>
          <h2>{node.name}</h2>
          <p className="muted">{node.local ? "Primary PC" : "Remote PC"} · Camera monitoring and recording</p>
        </div>
        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="status-dot" /> API {connected ? "Connected" : "Disconnected"}
        </div>
      </header>

      {!node.local && <div className="readonly-notice" role="status">Remote node: read-only monitoring. Use this computer locally to control its cameras and recordings.</div>}
      {node.local && settings && <details className="session-panel settings-panel compact-collapsible">
        <summary>Device and network settings</summary>
        <div className="section-heading"><h3>Configuration</h3>
          <button type="button" onClick={() => setShowDeviceManager((value) => !value)}>
            {showDeviceManager ? "Close device manager" : "Manage cameras and microphones"}
          </button>
        </div>
        <p className="muted">Hidden devices stay installed in Windows. Settings are stored by the backend and survive restarts.</p>
        {showDeviceManager && <div className="device-manager">
          {allDevices.map((device) => {
            const preference = settings.devices[device.id] ?? {};
            return <div className="device-manager-row" key={device.id}>
              <div><strong>{device.kind === "video" ? "Camera" : "Microphone"}: {device.displayName || device.name}</strong>
                <small className="muted device-id">{device.id}</small></div>
              <label className="field"><span>Friendly name</span>
                <input value={preference.alias ?? ""} placeholder={device.name}
                  onChange={(e) => editDevice(device.id, {alias: e.target.value})}/></label>
              {device.kind === "video" && <label className="field"><span>Paired microphone</span>
                <select value={preference.pairedMicrophoneId ?? ""} onChange={(e) => editDevice(device.id, {pairedMicrophoneId: e.target.value})}>
                  <option value="">Not paired</option>
                  {allDevices.filter((item) => item.kind === "audio").map((mic) =>
                    <option key={mic.id} value={mic.id}>{settings.devices[mic.id]?.alias || mic.displayName || mic.name}</option>)}
                </select></label>}
              <label className="device-toggle"><input type="checkbox" checked={preference.hidden === true}
                onChange={(e) => editDevice(device.id, {hidden: e.target.checked})}/> Hide</label>
            </div>;
          })}
          <button type="button" onClick={() => setSettings((old) => old ? ({...old, devices: Object.fromEntries(
            Object.entries(old.devices).map(([id, pref]) => [id, {...pref, hidden: false}]))}) : old)}>Restore all hidden devices</button>
        </div>}
        <div className="settings-network">
          <label className="field"><span>Network mode</span>
            <select value={settings.network.mode} onChange={(e) => setSettings((old) => old ? ({...old, network: {...old.network, mode: e.target.value as AppSettings["network"]["mode"]}}) : old)}>
              <option value="offline">Offline (localhost only)</option><option value="tailscale">Tailscale interface</option><option value="lan">Selected LAN interface</option>
            </select></label>
          <label className="field"><span>Bind address (requires backend restart)</span>
            <input value={settings.network.bindAddress} placeholder="127.0.0.1"
              onChange={(e) => setSettings((old) => old ? ({...old, network: {...old.network, bindAddress: e.target.value}}) : old)}/></label>
        </div>
        {networkStatus && <p role="status" style={{color: networkStatus.remote.state === "unavailable" ? "#d97706" : undefined}}>
          <strong>Remote access: {networkStatus.remote.state === "listening" ? "Listening" : networkStatus.remote.state === "unavailable" ? "Unavailable" : networkStatus.remote.state === "starting" ? "Starting" : "Disabled"}.</strong>{" "}
          {networkStatus.remote.message} Local dashboard remains available at {networkStatus.local.address}.
          {networkStatus.remote.state === "unavailable" && " Change the network settings above and save, then restart the backend."}
        </p>}
        <p className="muted">Offline mode does not start remote-node connections. YouTube streaming is separately controlled. Tailscale/LAN mode requires the exact IP of the intended network interface.</p>
        <div className="camera-actions"><button type="button" className="primary-button" disabled={settingsBusy} onClick={() => void saveSettings()}>Save settings</button>
          <button type="button" onClick={() => void downloadBackup()}>Download configuration backup</button></div>
        <div className="camera-actions"><label className="field"><span>Restore backup JSON</span>
          <input type="file" accept=".json,application/json" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}/></label>
          <button type="button" disabled={!restoreFile || settingsBusy || activeRecordings.length > 0} onClick={() => void restoreBackup()}>Restore backup</button></div>
        {settingsMessage && <p role="status">{settingsMessage}</p>}
      </details>}
      {node.local && <details className="session-panel compact-collapsible">
        <summary>Bulk YouTube key setup</summary>
        <div className="section-heading"><h3>Bulk YouTube key setup</h3></div>
        <p className="muted">Download a template containing detected camera IDs, fill in the streamKey fields on a trusted computer, then import the JSON. Keys are encrypted by the backend and are not included in ordinary configuration backups.</p>
        <div className="camera-actions">
          <button type="button" onClick={downloadYouTubeTemplate} disabled={!devices.cameras.length}>Download key template</button>
          <label className="field"><span>Import prepared key file</span>
            <input type="file" accept=".json,application/json" onChange={event => setKeyImportFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="primary-button" disabled={!keyImportFile || keyImportBusy} onClick={() => void importYouTubeKeys()}>
            {keyImportBusy ? "Importing..." : "Import stream keys"}
          </button>
        </div>
        {keyImportMessage && <p role="status">{keyImportMessage}</p>}
      </details>}
      <section className="session-panel">
        <div className="section-heading"><h3>Tournament session</h3>
          <span className="muted">Saved persistently on this node</span>
        </div>
        <label className="field">
          <span>Event name</span>
          <input value={session.eventName} placeholder="e.g. Fall Championship 2026"
            disabled={!node.local || sessionBusy || activeRecordings.length > 0}
            onChange={(event) => setSession((old) => ({ ...old, eventName: event.target.value }))} />
        </label>
        {session.eventId && <p className="muted">Permanent event ID: <code>{session.eventId}</code></p>}
        <div className="camera-actions">
          <label className="field"><span>Previously configured tournaments</span>
            <select value={eventToSelect} disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onChange={event => setEventToSelect(event.target.value)}>
              <option value="">Select a saved tournament</option>
              {availableEvents.map(item => <option key={item.eventId} value={item.eventId}>
                {item.eventName} ({item.assignmentCount} rings, {item.eventId.slice(0, 8)})
              </option>)}
            </select>
          </label>
          <button type="button" disabled={!node.local || sessionBusy || !eventToSelect || eventToSelect === session.eventId || activeRecordings.length > 0 || youtubeStreams.length > 0}
            onClick={() => void selectSavedTournament()}>Load Selected Tournament</button>
          <button type="button" disabled={!connected} onClick={() => void refreshEvents().catch(cause => setError(String(cause)))}>Refresh Tournament List</button>
          <div className="camera-actions">
            <select aria-label="Saved tournament template" value={templateToLoad}
              onChange={event => setTemplateToLoad(event.target.value)}>
              <option value="">Select setup template</option>
              {templates.map(item => <option key={item.templateId} value={item.templateId}>
                {item.name} ({item.assignmentCount} rings)
              </option>)}
            </select>
            <button type="button" disabled={!connected || templateBusy}
              onClick={() => void refreshTemplates().catch(cause => setError(String(cause)))}>Refresh Templates</button>
            <button type="button" disabled={!node.local || templateBusy || sessionBusy || !templateToLoad || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onClick={() => void loadTemplate()}>Apply Template</button>
            <button type="button" disabled={!node.local || templateBusy || sessionBusy || !session.eventId || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onClick={() => void saveTemplate()}>Save Setup as Template</button>
          </div>
        </div>
        {session.assignments.length > 0 && <div className="bulk-results" aria-label="Assignment device validation">
          <strong>Assignment device check</strong>
          {session.assignments.map(a => {
            const cameraFound = devices.cameras.some(c => c.id === a.cameraId);
            const micFound = devices.microphones.some(m => m.name === a.microphoneName);
            return <div key={a.cameraId + a.ring}>
              <strong>{a.ring}</strong>: {cameraFound ? "Camera connected" : `Camera missing (${a.cameraName})`}
              {" / "}{micFound ? "Microphone connected" : `Microphone missing (${a.microphoneName})`}
              {!cameraFound && <label> Replace camera: <select aria-label={`Replacement camera for ${a.ring}`} value=""
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onChange={e => { if (e.target.value) replaceAssignmentCamera(a.cameraId, e.target.value); }}>
                <option value="">Choose connected camera</option>
                {devices.cameras.filter(c => !session.assignments.some(other => other.cameraId === c.id && other.cameraId !== a.cameraId))
                  .map(c => <option key={c.id} value={c.id}>{labelFor(c.id, c.name)}</option>)}
              </select></label>}
              {!micFound && <label> Replace microphone: <select aria-label={`Replacement microphone for ${a.ring}`} value=""
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onChange={e => { if (e.target.value) replaceAssignmentMicrophone(a.cameraId, e.target.value); }}>
                <option value="">Choose connected microphone</option>
                {devices.microphones.filter(m => !session.assignments.some(other => other.cameraId !== a.cameraId && other.microphoneName === m.name))
                  .map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select></label>}
              {(!cameraFound || !micFound) && <button type="button"
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onClick={() => { setSession(old => ({ ...old, assignments: old.assignments.filter(item => item.cameraId !== a.cameraId) })); setPreflight(null); }}>
                Remove ring assignment</button>}
            </div>;
          })}
        </div>}
        <div className="session-assignments">
          {visibleCameras.map((camera) => {
            const assignment = session.assignments.find((item) => item.cameraId === camera.id);
            const pairedId = settings?.devices[camera.id]?.pairedMicrophoneId;
            const assignedMic = pairedId ? (allDevices.find((d) => d.id === pairedId)?.name ?? "") : (microphones[camera.id] ?? "");
            return <label className="field" key={camera.id}>
              <span>{labelFor(camera.id, camera.name)} ring assignment</span>
              <input value={assignment?.ring ?? ""} placeholder="e.g. Ring 1"
                disabled={!node.local || sessionBusy || activeRecordings.length > 0}
                onChange={(event) => setSession((old) => {
                  const rest = old.assignments.filter((item) => item.cameraId !== camera.id);
                  const ring = event.target.value;
                  return { ...old, assignments: ring ? [...rest, {
                    cameraId: camera.id, cameraName: camera.name,
                    microphoneName: assignedMic, ring
                  }] : rest };
                })} />
            </label>;
          })}
        </div>
        <div className="camera-actions">
          <button type="button" disabled={!node.local || sessionBusy || activeRecordings.length > 0}
            onClick={() => void saveSession()}>Save Session</button>
          <button type="button" disabled={!node.local || sessionBusy || activeRecordings.length > 0}
            onClick={() => void createNewTournament()}>Create New Tournament ID</button>
          <button type="button" disabled={preflightBusy || !connected} onClick={() => void runPreflight()}>{preflightBusy ? "Checking..." : "Run preflight checks"}</button>
          <button type="button" className="primary-button" disabled={!node.local || sessionBusy || !connected ||
            !session.assignments.length || activeRecordings.length > 0}
            onClick={() => void bulkAction("start-all")}>Start All Recordings</button>
          <button type="button" className="danger-button"
            disabled={!node.local || sessionBusy || !connected || activeRecordings.length === 0}
            onClick={() => void bulkAction("stop-all")}>Stop All Recordings</button>
        </div>
        <div className="camera-actions">
          <button type="button" className="primary-button"
            disabled={!node.local || sessionBusy || !connected || !session.assignments.length || activeRecordings.length === 0}
            onClick={() => void bulkYouTube("start-all")}>Start Assigned YouTube Streams</button>
          <button type="button" className="danger-button"
            disabled={!node.local || sessionBusy || !connected || youtubeStreams.length === 0}
            onClick={() => void bulkYouTube("stop-all")}>Stop All YouTube Streams</button>
        </div>
        {preflight && preflightDraft !== JSON.stringify(session) &&
          <p role="status">Assignments have changed since the last preflight. Run checks again.</p>}
        {preflight && preflightDraft === JSON.stringify(session) && <div className="bulk-results" role="status" aria-label="Preflight results">
          <strong>Preflight (current form): {preflight.ready ? "No blocking issues" : "Blocking issues found"}</strong>
          {preflight.checks.map((check, index) => <div key={index}>
            {check.level === "error" ? "ERROR" : check.level === "warning" ? "WARNING" : "OK"}: {check.message}
          </div>)}
          <small className="muted">Device and disk checks only. Camera bandwidth and recording performance still require a live test.</small>
        </div>}
        {bulkResults.length > 0 && <div className="bulk-results" role="status">
          {bulkResults.map((line, index) => <div key={index}>{line}</div>)}
        </div>}
      </section>

      <details className="tool-group compact-collapsible"><summary>System and USB Diagnostics</summary>
        <details className="tool-item compact-collapsible"><summary>System Resource Monitor and USB Diagnostics</summary>
      {node.local && <SystemResourceMonitor requestNode={requestNode} />}
      {node.local && <>
        <UsbTopologyDiagnostics requestNode={requestNode} nodeId={node.id} />
        <CameraAssetInventory nodeId={node.id} />
        <UsbBandwidthPlanner requestNode={requestNode} stressResults={stressResults} stressBusy={stressBusy} />
      </>}

        </details>

      </details>
      <details className="tool-group compact-collapsible"><summary>Streaming Health</summary>
        <details className="tool-item compact-collapsible"><summary>Capture Signal Health</summary>
      {node.local && <CaptureSignalHealthPanel requestNode={requestNode} nodeId={node.id} />}

        </details>
        <details className="tool-item compact-collapsible"><summary>Capture Recovery and Restart Safeguards</summary>
      {node.local && <CaptureRecoveryPanel requestNode={requestNode} />}
        </details>
        <details className="tool-item compact-collapsible"><summary>Capture and Streaming Quality</summary>
      <CaptureQualityPanel />
        </details>
        <details className="tool-item compact-collapsible"><summary>Tournament Readiness</summary>
      <section aria-label="Tournament readiness" className="overview">
        <h2>Tournament Readiness</h2>
        <p>Snapshot of unsaved assignments, connected devices, recording disk, recording health, and YouTube relay status.</p>
        <button type="button" disabled={!connected || readinessBusy}
          onClick={() => void checkTournamentReadiness()}>
          {readinessBusy ? "Checking readiness..." : "Check Tournament Readiness"}
        </button>
        {readinessError && <p role="alert">Readiness check failed: {readinessError}</p>}
        {readiness && readinessDraft !== JSON.stringify(session) &&
          <p role="alert">Assignments changed since the last readiness check. Run it again.</p>}
        {readiness && readinessDraft === JSON.stringify(session) && (
          <div className="bulk-results" role="status">
            <strong>{readiness.blockers.length ? "NOT READY" :
              readiness.warnings.length ? "READY WITH WARNINGS" : "CONFIGURATION READY"}</strong>
            <p>Checked: {new Date(readiness.checkedAt).toLocaleString()}.
              Point-in-time check only. Does not test USB bandwidth or YouTube connectivity.</p>
            <p>Storage: {readiness.storage ?
              `${fileSize(readiness.storage.freeBytes)} free (${readiness.storage.status})` :
              `Unavailable (${readiness.storageError || "unknown error"})`}</p>
            {readiness.blockers.map((item, i) => <p key={`block-${i}`}>BLOCKER: {item}</p>)}
            {readiness.warnings.map((item, i) => <p key={`warn-${i}`}>WARNING: {item}</p>)}
            {readiness.rings.map((item, i) => <div key={`${item.ring}-${i}`}>
              <strong>{item.ring || `Assignment ${i + 1}`}</strong>: {item.camera}
              {" | Camera: "}{item.cameraConnected ? "connected" : "MISSING"}
              {" | Mic: "}{item.microphoneConnected ? "connected" : "MISSING"}
              {" | Recording: "}{item.recording ? (item.recordingHealthy === false ? "warning" : "active") : "stopped"}
              {" | YouTube: "}{item.youtubeLive ? "live" : "not live"}
              {item.issues.length > 0 && <span> | Issues: {item.issues.join("; ")}</span>}
            </div>)}
          </div>
        )}
      </section>

      <RingPreTournamentSignoff nodeId={node.id} eventId={session.eventId || null}
        eventName={session.eventName} assignments={session.assignments} />
      <TournamentHardwareReport requestNode={requestNode} nodeId={node.id}
        eventName={session.eventName} eventId={session.eventId || null}
        assignments={session.assignments} readiness={readiness}
        readinessCurrent={readinessDraft === JSON.stringify(session)}
        latestStress={savedStressReports.length ? savedStressReports[savedStressReports.length - 1] : null}
        equipmentTests={equipmentTests} />


        </details>
        <details className="tool-item compact-collapsible"><summary>FFmpeg Encoder Diagnostics</summary>
      <section aria-label="FFmpeg encoder diagnostics" className="overview">
        <h2>FFmpeg Encoder Diagnostics</h2>
        <p>FFmpeg's reported encoding FPS, processing speed, dropped-frame count and bitrate for each running capture process.
          Because each capture produces recording, preview, and relay outputs, these figures are aggregate process statistics,
          not verified recording-only FPS. The recording input is currently configured for 1080p30.</p>
        <button type="button" disabled={!connected || encoderStatsBusy}
          onClick={() => void refreshEncoderStats()}>
          {encoderStatsBusy ? "Checking..." : "Refresh Encoder Diagnostics"}
        </button>
        {encoderStatsError && <p role="alert">{encoderStatsError}</p>}
        {encoderStats && <div className="bulk-results" role="status">
          <small>Snapshot: {new Date(encoderStats.checkedAt).toLocaleTimeString()}</small>
          {encoderStats.captures.length === 0 && <p>No active recordings.</p>}
          {encoderStats.captures.map(item => <p key={item.cameraId}>
            <strong>{item.cameraName}</strong>: {item.encoder ?
              `FPS ${item.encoder.fps?.toFixed(1) ?? "N/A"} | Speed ${item.encoder.speed?.toFixed(2) ?? "N/A"}x | Dropped ${item.encoder.droppedFrames ?? "N/A"} | Bitrate ${item.encoder.bitrateKbps?.toFixed(0) ?? "N/A"} kb/s | Sample age ${Math.round(item.encoder.ageMs / 1000)}s` :
              "Waiting for FFmpeg progress data"}
            {item.encoder && (item.encoder.ageMs > 10000 || (item.encoder.speed !== null && item.encoder.speed < 0.9)) &&
              <span> | WARNING: encoder may be falling behind</span>}
          </p>)}
          <small>Refresh to sample again. A single snapshot cannot establish sustained frame loss; use the 30-second stress test alongside this view.</small>
        </div>}
      </section>


        </details>
        <details className="tool-item compact-collapsible"><summary>Multi-Camera Recording Stress Test</summary>
      <section aria-label="Multi-camera recording stress test" className="overview">
        <h2>Multi-Camera Recording Stress Test</h2>
        <p>Start local recordings on at least two cameras, then monitor all active recordings together for 30 seconds.
          This does not start or stop cameras, change YouTube streams, or save additional test footage.
          Frame rate below is the 5 fps preview sampling rate, not the 30/60 fps encoded recording rate.
          This is a recording pipeline test, not a direct USB bandwidth measurement.</p>
        <button type="button" disabled={!connected || !node.local || stressBusy}
          onClick={() => void runCameraStressTest()}>
          {stressBusy ? `Testing... ${stressProgress}/30 seconds` : "Run 30-second multi-camera test"}
        </button>
        {stressError && <p role="alert">{stressError}</p>}
        {stressResults && <div className="bulk-results" role="status">
          <strong>Results: {stressResults.filter(item => item.status === "pass").length}/{stressResults.length} passed</strong>
          {stressResults.map(item => <p key={item.cameraId}>
            <strong>{item.cameraName}: {item.status.toUpperCase()}</strong>
            {` | Preview: ${item.observedFps.toFixed(1)} fps | File growth: ${item.growthBytes === null ? "unknown" : fileSize(item.growthBytes)}`}
            {` | Stale frames: ${item.staleSamples} | Missing samples: ${item.missingSamples}`}
            {item.restarted ? " | Recording restarted during test" : ""}
          </p>)}
          <small>Results reflect only the 30-second sample window. Check recorded files with FFprobe separately.</small>
        </div>}
        {stressResources && <>
          <StressResourceSummary report={stressResources} cameraResults={stressResults || []} />
          <div className="bulk-results">
            <strong>Export completed stress test</strong>
            <p>JSON includes full camera results and timestamped resource readings. CSV contains
              camera and resource rows with a recordType column for filtering and comparison.</p>
            <button type="button" disabled={stressBusy || !stressResults}
              onClick={() => exportStressReport("json")}>Download stress test JSON</button>
            <button type="button" disabled={stressBusy || !stressResults}
              onClick={() => exportStressReport("csv")}>Download stress test CSV</button>
          </div>
        </>}
        <div className="bulk-results" aria-label="Compare saved stress test reports">
          <h3>Compare saved stress tests</h3>
          <p>Import up to 12 milestone 43 JSON reports to compare camera outcomes and average system load.
            Files stay in this browser session and are not uploaded. CSV exports are not supported here.</p>
          <div className="bulk-results" aria-label="Persistent stress test history">
            <h3>Saved test history</h3>
            <p>Completed tests are automatically saved in this browser, up to 30 entries.
              Give the next test a configuration label, such as “PCIe card: 3 cameras, 1080p60”.
              Browser data can be cleared, so export JSON for durable backups.</p>
            <label>Next test label <input type="text" maxLength={100} value={historyLabel}
              onChange={event => setHistoryLabel(event.target.value)}
              placeholder="e.g. 8 cameras, PCIe card, high quality" /></label>
            {historyError && <p role="alert">{historyError}</p>}
            {savedStressReports.length > 0 && <>
              <button type="button" onClick={() => {
                if (window.confirm("Delete all saved stress-test history from this browser?"))
                  updateStressHistory(() => []);
              }}>Clear saved history</button>
              <div style={{ overflowX: "auto" }}><table><thead><tr><th>Configuration label</th>
                <th>Started</th><th>Cameras</th><th>Failures</th><th>Actions</th></tr></thead><tbody>
                {savedStressReports.slice().reverse().map(entry => <tr key={entry.id}>
                  <td><input aria-label={`Label for ${entry.filename}`} value={entry.label} maxLength={100}
                    onChange={event => updateStressHistory(previous => previous.map(item =>
                      item.id === entry.id ? { ...item, label: event.target.value } : item))} /></td>
                  <td>{entry.report.startedAt}</td><td>{entry.report.cameraResults.length}</td>
                  <td>{entry.report.cameraResults.filter(camera => camera.status === "failed").length}</td>
                  <td><button type="button" onClick={() => setComparisonReports(previous =>
                    [...previous, { filename: entry.label, report: entry.report }].slice(-12))}>Compare</button>{" "}
                    <button type="button" onClick={() => updateStressHistory(previous =>
                      previous.filter(item => item.id !== entry.id))}>Delete</button></td>
                </tr>)}</tbody></table></div>
            </>}
          </div>
          <label>Import stress-test JSON reports <input type="file" accept=".json,application/json" multiple
            onChange={event => { void importStressReports(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>
          {comparisonError && <pre role="alert">{comparisonError}</pre>}
          {comparisonReports.length > 0 && <>
            <button type="button" onClick={() => setComparisonReports([])}>Clear comparisons</button>
            <div style={{ overflowX: "auto" }}><table>
              <thead><tr><th>Report</th><th>Started</th><th>Cameras</th><th>Pass</th><th>Warning</th><th>Failed</th>
                <th>Avg preview FPS</th><th>Avg CPU</th><th>Avg GPU</th><th>Avg disk writes</th></tr></thead>
              <tbody>{comparisonReports.map(({ filename, report }, index) => {
                const metrics = summarizeComparison(report);
                return <tr key={`${filename}-${index}`}><td>{filename}</td><td>{report.startedAt}</td>
                  <td>{metrics.count}</td><td>{metrics.passes}</td><td>{metrics.warnings}</td><td>{metrics.failed}</td>
                  <td>{metrics.averagePreviewFps === null ? "n/a" : metrics.averagePreviewFps.toFixed(1)}</td>
                  <td>{metrics.cpu === null ? "n/a" : `${metrics.cpu.toFixed(1)}%`}</td>
                  <td>{metrics.gpu === null ? "n/a" : `${metrics.gpu.toFixed(1)}%`}</td>
                  <td>{metrics.disk === null ? "n/a" : `${(metrics.disk / 1_000_000).toFixed(1)} MB/s`}</td>
                </tr>;
              })}</tbody>
            </table></div>
            <p>Compare like-for-like tests with the same camera count, duration, scene, and recording settings.
              Preview FPS is not encoded FPS. CPU/GPU/disk counters are system-wide and do not prove causation.</p>
          </>}
        </div>
      </section>


        </details>
        <details className="tool-item compact-collapsible"><summary>Camera and Microphone Test Mode</summary>
      <section aria-label="Camera and microphone test mode" className="overview">
        <h2>Camera and Microphone Test Mode</h2>
        <p>Start a camera preview to verify live video. Speak into the microphone during the three-second audio test.
          No test audio is recorded or uploaded.</p>
        {equipmentTestError && <p role="alert">{equipmentTestError}</p>}
        {session.assignments.length === 0 && <p>Assign cameras to rings to enable equipment testing.</p>}
        {session.assignments.map(assignment => {
          const result = equipmentTests[assignment.cameraId];
          const current = result?.microphoneName === assignment.microphoneName ? result : null;
          return <div key={assignment.cameraId + assignment.ring} className="bulk-results">
            <strong>{assignment.ring}: {assignment.cameraName}</strong> ({assignment.microphoneName}){" "}
            <button type="button" disabled={!connected || !node.local || equipmentTesting !== null}
              onClick={() => void testRingEquipment(assignment)}>
              {equipmentTesting === assignment.cameraId ? "Testing..." : "Test Camera and Microphone"}
            </button>
            {current && <div role="status">
              <p>Video: {current.video.status.toUpperCase()}. {current.video.message}</p>
              <p>Microphone: {current.audio.status.toUpperCase()}. {current.audio.message}
                {current.audio.maxDb !== null && ` Peak: ${current.audio.maxDb.toFixed(1)} dBFS.`}</p>
              <small>Tested {new Date(current.checkedAt).toLocaleTimeString()}. Results are a snapshot.</small>
            </div>}
          </div>;
        })}
      </section>


        </details>

      </details>
      <details className="tool-group compact-collapsible"><summary>Recording and Tournament Operations</summary>
        <details className="tool-item compact-collapsible"><summary>Tournament Recording Summary</summary>
      <section aria-label="Tournament recording summary" className="overview">
        <div>
          <strong>Tournament recording summary</strong>{" "}
          <button type="button" disabled={!connected || summaryBusy}
            onClick={() => void refreshRecordingSummary()}>
            {summaryBusy ? "Calculating..." : "Refresh summary"}
          </button>
          {recordingSummary && <label> Event: <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
            <option value="">All recent sessions</option>
            {recordingSummary.events.map(event => <option key={event.eventId} value={event.eventId}>{event.eventName} ({event.eventId.split(":")[0]})</option>)}
          </select></label>}
          {summaryError && <p role="alert">{summaryError}</p>}
          {recordingSummary && <>
            <p>{recordingSummary.totals.sessions} sessions across {recordingSummary.cameras.length} cameras,
              {" "}{recordingSummary.totals.segments} segments, {fileSize(recordingSummary.totals.bytes)} total.
              {" "}{recordingSummary.totals.active} active, {recordingSummary.totals.failures} failed,
              {" "}{recordingSummary.totals.warnings} integrity warnings.</p>
            <p>Known recording duration: {(recordingSummary.totals.knownDurationSeconds / 3600).toFixed(2)} hours.
              {recordingSummary.totals.unknownDurationSessions > 0 &&
                ` ${recordingSummary.totals.unknownDurationSessions} sessions have unknown duration.`}</p>
            {recordingSummary.truncated && <p role="status">Only the latest 200 sessions are included.</p>}
            <p className="muted">Ring names are snapshots taken when recording began.
              {recordingSummary.unattributedSessions > 0 && ` ${recordingSummary.unattributedSessions} older or unassigned sessions lack event attribution.`}
              {" "}Events are grouped by name and recording start date, so same-name events on the same day share a group.
              Duration is elapsed session time, not verified playable footage.</p>
            <div style={{ overflowX: "auto" }}>
              <table><thead><tr><th>Ring / Camera</th><th>Sessions</th><th>Active</th>
                <th>Failures</th><th>Warnings</th><th>Segments</th><th>Storage</th><th>Known hours</th>
              </tr></thead><tbody>
                {recordingSummary.cameras.map(item => <tr key={item.cameraId}>
                  <td>{item.ring ? `${item.ring} / ` : ""}{item.cameraName}</td>
                  <td>{item.sessions}</td><td>{item.active}</td><td>{item.failures}</td>
                  <td>{item.warnings}</td><td>{item.segments}</td><td>{fileSize(item.bytes)}</td>
                  <td>{(item.knownDurationSeconds / 3600).toFixed(2)}</td>
                </tr>)}
              </tbody></table>
            </div>
          </>}
        </div>
      </section>


        </details>
        <details className="tool-item compact-collapsible"><summary>Recording Session History</summary>
      <section aria-label="Recording session history" className="overview">
        <div>
          <strong>Recording history and segment checks</strong>{" "}
          <button type="button" disabled={!connected || pastSessionsLoading}
            onClick={() => void refreshPastSessions()}>
            {pastSessionsLoading ? "Checking..." : "Refresh history"}
          </button>
          {" "}
          <button type="button" disabled={!connected || !node.local || reportBusy}
            onClick={() => void downloadRecordingReport("csv")}>Export CSV report</button>
          {" "}
          <button type="button" disabled={!connected || !node.local || reportBusy}
            onClick={() => void downloadRecordingReport("json")}>Export JSON diagnostics</button>
          {reportBusy && <span role="status">Preparing report...</span>}
          {pastSessionsError && <p role="alert">{pastSessionsError}</p>}
          {pastSessions.map((item, index) => <details key={`${item.startedAt}-${item.cameraId}-${index}`}>
            <summary>{item.eventName ? `${item.eventName} / ` : ""}{item.ring ? `${item.ring} / ` : ""}{item.cameraName} | {new Date(item.startedAt).toLocaleString()} | {item.outcome}
              {" "}| {item.integrity.status} | {item.integrity.segments.length} segments</summary>
            <p>Finished: {item.endedAt ? new Date(item.endedAt).toLocaleString() : "Not recorded"}</p>
            <p>Size: {fileSize(item.integrity.totalBytes ?? 0)}</p>
            {item.integrity.issues.map((issue, i) => <p key={i} role="alert">{issue}</p>)}
            {item.integrity.segments.map((segment) => <div key={segment.name}>
              {segment.name}: {fileSize(segment.bytes)}
            </div>)}
            <button type="button" disabled={!connected || validationBusy || item.outcome === "started"}
              onClick={() => void validateSession(item.recordingPath)}>
              {validationBusy ? "Validating..." : "Validate media with FFprobe"}
            </button>
            {validationResults[item.recordingPath] && <div role="status">
              <strong>Media validation: {validationResults[item.recordingPath].status}</strong>
              <p>Checked {validationResults[item.recordingPath].checked} of {validationResults[item.recordingPath].total} segments.</p>
              {validationResults[item.recordingPath].issues.map((issue, i) => <p key={i} role="alert">{issue}</p>)}
            </div>}
            <small>Basic checks above verify file size and sequence. FFprobe checks metadata and streams, not full video decoding.</small>
          </details>)}
        </div>
      </section>


        </details>
        <details className="tool-item compact-collapsible"><summary>Tournament-day Operations and Alerts</summary>
      <section className="session-panel" aria-label="Tournament day operations">
        <div className="section-heading"><h3>Tournament-day operations</h3>
          <span className="muted">Live node status · updates every 2 seconds</span></div>
        <p className="muted">One view of assigned rings, local recordings, YouTube relay status, and urgent warnings.
          An idle ring is not considered an error until the operator expects it to be active.</p>
        {!connected && <p role="alert" className="camera-warning">Node API disconnected. Displayed data may be stale.</p>}
        {storageHealth?.status === "critical" && <p role="alert" className="camera-warning">Critical recording storage: {fileSize(storageHealth.freeBytes)} remaining.</p>}
        {storageError && <p role="alert" className="camera-warning">Storage status unavailable: {storageError}</p>}
        <div className="overview">
          <div className="metric"><span>Assigned rings</span><strong>{session.assignments.length}</strong></div>
          <div className="metric"><span>Recording rings</span><strong>{session.assignments.filter(a => captures.some(c => c.cameraId === a.cameraId && c.running)).length}</strong></div>
          <div className="metric"><span>Live relays</span><strong>{session.assignments.filter(a => youtubeStreams.some(y => y.cameraId === a.cameraId && y.status === "live")).length}</strong></div>
          <div className="metric"><span>Recording warnings</span><strong>{captureHealth.filter(h => h.status === "warning").length}</strong></div>
        </div>
        {session.assignments.length === 0 ? <p>No rings assigned in the current tournament session.</p> :
          <div style={{overflowX: "auto"}}><table>
            <thead><tr><th>Ring</th><th>Camera</th><th>Recording</th><th>YouTube</th><th>Preview</th><th>Alerts</th></tr></thead>
            <tbody>{session.assignments.map(assignment => {
              const capture = captures.find(c => c.cameraId === assignment.cameraId);
              const health = captureHealth.find(h => h.cameraId === assignment.cameraId);
              const stream = youtubeStreams.find(y => y.cameraId === assignment.cameraId);
              const present = devices.cameras.some(d => d.id === assignment.cameraId);
              const alerts = [
                !present ? "Camera not detected" : null,
                health?.status === "warning" ? health.warnings.join("; ") || "Recording warning" : null,
                capture?.previewFrozen ? "Preview frozen" : null,
                stream?.status === "error" ? stream.error || "YouTube relay error" : null,
                storageHealth?.status === "critical" ? "Storage critical" : null
              ].filter((value): value is string => Boolean(value));
              return <tr key={assignment.cameraId}>
                <td>{assignment.ring}</td><td>{labelFor(assignment.cameraId, assignment.cameraName)}</td>
                <td>{capture?.running ? `Recording · ${duration(capture.startedAt, now)}` : "Idle"}</td>
                <td>{stream ? `${stream.status}${stream.progressAgeMs !== null ? ` · ${Math.round(stream.progressAgeMs / 1000)}s since progress` : ""}` : "Not live"}</td>
                <td>{capture?.previewFrozen ? "Frozen" : capture?.previewAvailable ? "Available" : "Unavailable"}</td>
                <td>{alerts.length ? <strong className="camera-warning" role="alert">{alerts.join("; ")}</strong> : "No detected alerts"}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        <p className="muted">Status reflects this node only. Remote nodes appear in their own read-only dashboard.
          A YouTube relay marked live indicates local relay progress, not independently verified public playback.</p>
      </section>

      <section className="session-panel" aria-label="Operations alert thresholds">
        <label>Warn when an active YouTube relay reports no progress for
          <select value={relayStaleSeconds} onChange={e => setRelayStaleSeconds(Number(e.target.value))}>
            {[15, 30, 60, 120].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select>
        </label>
        <p className="muted">This threshold applies only to relays reported as live, and measures reported local relay progress, not public YouTube playback.</p>
      </section>
      <section className="session-panel" aria-label="USB reliability alert integration">
        <h3>USB connection alerts</h3>
        <p className="muted">Connection warnings from the capture node are included in Operations alerts
          and the automatic critical incident workflow. Acknowledging an alert does not repair a camera.
          Counts are based on sampled history, not proof of a USB controller fault.</p>
        <p>{usbConnectionWarnings.length} active USB reliability warning(s).
          {!usbWarningsReady ? " Waiting for first successful analysis." : ""}</p>
        {usbWarningsError && <p className="camera-warning" role="status">
          USB reliability data may be stale: {usbWarningsError}
        </p>}
      </section>
      <OperationsAlertHistory nodeId={node.id} eventId={session.eventId || ""}
        alerts={operationsAlerts} online={connected && usbWarningsReady && !usbWarningsError} />

        </details>

      </details>
      <details className="tool-group compact-collapsible"><summary>Incident Reports and Analytics</summary>
      <details className="tool-item compact-collapsible"><summary>Incident Log</summary>
      <IncidentLog key={`${node.id}:${session.eventId || "unsaved"}`} nodeId={node.id}
        eventId={session.eventId || ""} alerts={operationsAlerts}
        online={connected && usbWarningsReady && !usbWarningsError} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Incident Trends</summary>
      <IncidentTrends key={`trends:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament To Tournament Comparison</summary>
      <TournamentToTournamentComparison />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament Reliability Trends</summary>
      <TournamentReliabilityTrends />
      </details>
      <details className="tool-item compact-collapsible"><summary>Post Tournament Technical Report</summary>
      <PostTournamentTechnicalReport key={`post-report:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} eventName={session.eventName || ""}
        requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Incident Heatmap</summary>
      <IncidentHeatmap key={`heatmap:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Incident Analytics</summary>
      <IncidentAnalytics key={`analytics:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Incident Timeline</summary>
      <IncidentTimeline key={`timeline:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament Technical Summary</summary>
      <TournamentTechnicalSummary key={`summary:${node.id}:${session.eventId || "unsaved"}`}
        nodeId={node.id} eventId={session.eventId || ""} eventName={session.eventName || ""}
        requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament Report Archive</summary>
      <TournamentReportArchive />
      </details>

      </details>
      <details className="tool-group compact-collapsible"><summary>Camera Reliability and Troubleshooting</summary>
      <details className="tool-item compact-collapsible"><summary>Recording Configuration Reliability Panel</summary>
      <RecordingConfigurationReliabilityPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Configuration Reliability Panel</summary>
      <CameraConfigurationReliabilityPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Reliability Warnings Panel</summary>
      <ReliabilityWarningsPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Health Panel</summary>
      <CameraHealthPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Health History Panel</summary>
      <CameraHealthHistoryPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Disconnection Analysis</summary>
      <CameraDisconnectionAnalysis requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>USB Reliability Warnings Panel</summary>
      <UsbReliabilityWarningsPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>USB Recording Correlation Panel</summary>
      <UsbRecordingCorrelationPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Troubleshooting Panel</summary>
      <CameraTroubleshootingPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Guided Troubleshooting Tests</summary>
      <GuidedTroubleshootingTests />
      </details>
      <details className="tool-item compact-collapsible"><summary>Failure Investigation Panel</summary>
      <FailureInvestigationPanel requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Camera Reliability Dashboard</summary>
      <CameraReliabilityDashboard requestNode={requestNode} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament Readiness Overview</summary>
      <TournamentReadinessOverview requestNode={requestNode} readiness={readiness}
        readinessCurrent={readinessDraft === JSON.stringify(session)} captures={captures}
        streamCount={youtubeStreams.length} nodeId={node.id} eventId={session.eventId || "unsaved"}
        assignments={session.assignments} />
      </details>
      <details className="tool-item compact-collapsible"><summary>Tournament Launch Shutdown Guide</summary>
      <TournamentLaunchShutdownGuide nodeId={node.id} eventId={session.eventId || "unsaved"}
        assignments={session.assignments} captures={captures} streams={youtubeStreams} requestNode={requestNode} />
      </details>


      </details>
      <section className="overview" aria-label="Recording overview">
        <div className="metric"><span>Discovered cameras</span><strong>{visibleCameras.length}</strong></div>
        <div className="metric"><span>Active previews</span><strong>{previews.length}</strong></div>
        <div className="metric"><span>Recording</span><strong>{activeRecordings.length}</strong></div>
        <div className="metric"><span>YouTube relays</span><strong>{youtubeStreams.length}</strong></div>
        <div className="metric"><span>Healthy recordings</span><strong>{healthy} / {activeRecordings.length}</strong></div>
      </section>

      {storageHealth && (
        <p role="status" className={storageHealth.status === "healthy" ? "muted" : "camera-warning"}>
          Recording storage: {fileSize(storageHealth.freeBytes)} free
          {" "}({storageHealth.status.toUpperCase()}, warning below 50 GiB, critical below 10 GiB).
          {storageHealth.status !== "healthy" && " Check disk capacity before starting more recordings."}
        </p>
      )}
      {storageError && <p role="alert" className="camera-warning">Recording storage status unavailable: {storageError}</p>}
      {captureHealth.some(item => item.status === "warning") && (
        <div className="alert" role="alert" aria-label="Recording health warnings">
          <strong>Recording health warnings</strong>
          {captureHealth.filter(item => item.status === "warning").map(item => (
            <p key={item.cameraId}>
              {labelFor(item.cameraId, item.cameraName)}: {item.warnings.join(" ")}
            </p>
          ))}
          <small>Monitoring only. Recordings are not restarted automatically.</small>
        </div>
      )}
      {activeRecordings.length > 0 && <p className="muted" role="status">
        Backend health: {captureHealth.filter(item => item.status === "healthy").length} healthy,
        {" "}{captureHealth.filter(item => item.status === "starting").length} starting,
        {" "}{captureHealth.filter(item => item.status === "warning").length} warning
      </p>}

      {recordingEvents.some((event) => event.type === "recording_failed") && (
        <details className="recording-event-panel">
          <summary>Recording interruptions ({recordingEvents.filter((event) => event.type === "recording_failed").length} since backend startup)</summary>
          {recordingEvents.filter((event) => event.type === "recording_failed").slice(0, 12).map((event, index) => (
            <p key={`${event.timestamp}-${index}`} className="camera-warning">
              {new Date(event.timestamp).toLocaleString()} · {labelFor(event.cameraId, event.cameraId)} · {event.detail}
            </p>
          ))}
        </details>
      )}
      {error && <div className="alert" role="alert">{error} <button onClick={() => setError(null)}>Dismiss</button></div>}
      {unhealthy.length > 0 && (
        <div className="alert" role="alert">
          Recording warning: {unhealthy.map((capture) => labelFor(capture.cameraId, capture.cameraName)).join(", ")}
        </div>
      )}

      <div className="section-heading">
        <h2>Cameras</h2>
        <button type="button" onClick={() => void refreshDevices()} disabled={devicesLoading}>
          {devicesLoading ? "Scanning..." : "Refresh Devices"}
        </button>
      </div>

      <div className="camera-grid">
        {visibleCameras.map((camera) => {
          const capture = captures.find((item) => item.cameraId === camera.id);
          const preview = previews.find((item) => item.cameraId === camera.id);
          const youtube = youtubeStreams.find((item) => item.cameraId === camera.id);
          const isPreviewing = Boolean(preview);
          const busy = busyIds.includes(camera.id);
          const expanded = expandedId === camera.id;
          const pairedId = settings?.devices[camera.id]?.pairedMicrophoneId;
            const assignedMic = pairedId ? (allDevices.find((d) => d.id === pairedId)?.name ?? "") : (microphones[camera.id] ?? "");
          const micBusy = Boolean(assignedMic) && captures.some((item) =>
            item.cameraId !== camera.id && item.microphoneName === assignedMic);
          const frameAvailable = preview ? preview.previewAvailable : capture?.previewAvailable;
          const frozen = preview ? preview.previewFrozen : capture?.previewFrozen;
          const source = preview
            ? `${base}/api/previews/${encodeURIComponent(camera.id)}/frame?t=${frameTick}`
            : `${base}/api/captures/${encodeURIComponent(camera.id)}/frame?t=${frameTick}`;
          const sizeStalled = Boolean(capture && history[camera.id] &&
            now - history[camera.id].lastGrowthAt > 10000);
          const status = capture ? (frozen ? "Preview frozen" : sizeStalled ? "Recording stalled" : "Recording")
            : preview ? (preview.status === "error" ? "Preview error" :
              frozen ? "Preview frozen" : preview.status === "starting" ? "Starting preview" : "Previewing")
            : "Idle";
          return (
            <article className={`camera-card ${expanded ? "camera-card-expanded" : ""}`} key={camera.id}>
              <div className="camera-card-header">
                <strong>{labelFor(camera.id, camera.name)}</strong>
                <span className={`camera-state ${capture ? "recording" : preview ? "previewing" : "idle"}`}>
                  {status}
                </span>
              </div>

              <div className="camera-preview">
                {frameAvailable ? (
                  <img src={source} alt={`${labelFor(camera.id, camera.name)} live preview`}
                    className="camera-preview-video" />
                ) : (
                  <div className="camera-preview-placeholder">
                    {preview || capture ? "Waiting for video..." : "Preview inactive"}
                  </div>
                )}
              </div>

              {(frozen || sizeStalled || preview?.status === "error") && (
                <div className="camera-warning" role="alert">
                  {sizeStalled ? "Recording file has not grown for over 10 seconds." :
                    frozen ? "No new preview frames for over 3 seconds." :
                    "Preview process failed. Stop and restart preview."}
                </div>
              )}

              <div className="camera-actions camera-primary-actions">
                <button type="button" disabled={!node.local || !connected || busy}
                  onClick={() => void togglePreview(camera, isPreviewing)}>
                  {busy ? "Working..." : isPreviewing ? "Stop Preview" : "Start Preview"}
                </button>
                <button type="button" className={capture ? "danger-button" : "primary-button"}
                  disabled={!node.local || !connected || busy || (!capture && (!assignedMic || micBusy))}
                  onClick={() => void toggleRecording(camera, capture)}>
                  {busy ? "Working..." : capture ? "Stop Recording" : "Record"}
                </button>
                <button type="button" onClick={() => setExpandedId(expanded ? null : camera.id)}>
                  {expanded ? "Collapse" : "Identify"}
                </button>
                <button type="button" disabled={!node.local || busy || !connected ||
                  (!youtube && (!capture || (!streamKeys[camera.id]?.trim() && !savedProfiles[camera.id])))}
                  onClick={() => void toggleYouTube(camera.id, Boolean(youtube))}>
                  {youtube ? "Stop Stream" : "Start Stream"}
                </button>
              </div>

              <details className="camera-settings-details compact-collapsible">
                <summary>Camera settings and stream key</summary>
                {capture?.running && <button type="button" disabled={!node.local || !connected || busy}
                  onClick={() => void recoverRecording(camera)}>Restart Recording (5 min cooldown, max 2/hour)</button>}

              <div className="youtube-controls">
                <div className="youtube-heading">
                  <strong>YouTube Live</strong>
                  <span className={youtube?.status === "live" ? "youtube-live" : "muted"}>
                    {youtube ? (youtube.progressAgeMs !== null && youtube.progressAgeMs > 10000
                      ? "No recent output" : youtube.status) : "Offline"}
                  </span>
                </div>
                {!youtube && (
                  <label className="field">
                    <span>Stream key (leave blank to use saved profile)</span>
                    <div className="key-input">
                      <input
                        type={showKeys[camera.id] ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={streamKeys[camera.id] ?? ""}
                        placeholder="Paste YouTube stream key"
                        onChange={(event) => setStreamKeys((old) =>
                          ({ ...old, [camera.id]: event.target.value }))}
                      />
                      <button type="button" onClick={() => setShowKeys((old) =>
                        ({ ...old, [camera.id]: !old[camera.id] }))}>
                        {showKeys[camera.id] ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                )}
                {!youtube && <div className="camera-actions">
                  {savedProfiles[camera.id] && <span className="muted">Saved: {savedProfiles[camera.id]}</span>}
                  <button type="button" disabled={!node.local || !streamKeys[camera.id]?.trim()} onClick={() => void saveYouTubeKey(camera)}>Save key</button>
                  {savedProfiles[camera.id] && <button type="button" disabled={!node.local} onClick={() => void deleteYouTubeKey(camera.id)}>Forget key</button>}
                </div>}
                {!capture && !youtube && <small className="muted">Start recording before streaming.</small>}
                {youtube?.error && <div className="camera-warning">{youtube.error}</div>}
              </div>

              <label className="field">
                <span>Camera label</span>
                <input value={settings?.devices[camera.id]?.alias ?? labels[camera.id] ?? ""} placeholder="e.g. Ring 1"
                  disabled={!node.local} onChange={(event) => settings ? editDevice(camera.id, {alias: event.target.value}) : setLabels((old) => ({ ...old, [camera.id]: event.target.value }))} />
              </label>
              <label className="field">
                <span>Microphone</span>
                <select value={pairedId ?? ""} disabled={!node.local || Boolean(capture)}
                  onChange={(event) => {
                    const microphoneId = event.target.value;
                    const microphoneName = devices.microphones.find(m => m.id === microphoneId)?.name ?? "";
                    editDevice(camera.id, { pairedMicrophoneId: microphoneId });
                    setMicrophones((old) => ({ ...old, [camera.id]: microphoneName }));
                    setSession((old) => ({ ...old, assignments: old.assignments.map((item) =>
                      item.cameraId === camera.id ? { ...item, microphoneName } : item) }));
                  }}>
                  <option value="">Select microphone</option>
                  {devices.microphones.map((mic, index) =>
                    <option key={mic.id} value={mic.id}>{settings?.devices[mic.id]?.alias || `${mic.name} #${index + 1}`}</option>)}
                </select>
              </label>
              {micBusy && <span className="camera-warning">Microphone in use by another recording</span>}

              </details>
              {capture && (
                <div className="recording-details">
                  <div><span>Duration</span><strong>{duration(capture.startedAt, now)}</strong></div>
                  <div><span>File size</span><strong>{fileSize(capture.recordingFileSize)}</strong></div>
                  <div><span>Frame count</span><strong>{capture.frameCount.toLocaleString()}</strong></div>
                  <div><span>File growth</span><strong>{history[camera.id]
                    ? `${Math.floor((now - history[camera.id].lastGrowthAt) / 1000)}s ago` : "Checking..."}</strong></div>
                  <p className="filename">Segments: {capture.segmentCount ?? 0} | Active: {capture.activeSegment?.split(/[\\/]/).pop() ?? "Starting"}</p>
                  <p className="filename" title={capture.recordingPath}>
                    {capture.recordingPath.split(/[\\/]/).pop()}
                  </p>
                </div>
              )}
              {!capture && preview && (
                <div className="camera-frame-stats">
                  <span>Source: {preview.source}</span>
                  <span>Frames: {preview.frameCount.toLocaleString()}</span>
                </div>
              )}
              <details className="device-details">
                <summary>Device details</summary>
                <p><strong>Model:</strong> {camera.name}</p>
                <p className="device-id">{camera.id}</p>
                <button type="button" onClick={() => void navigator.clipboard.writeText(camera.id)}>
                  Copy Device ID
                </button>
              </details>
            </article>
          );
        })}
      </div>
      {visibleCameras.length === 0 && <p className="muted">No cameras detected. Try Refresh Devices.</p>}
    </section>
  );
}


interface CameraCapabilityResult {
  cameraName: string;
  detected: boolean;
  requestedFps: number;
  selectedMode: { width: number; height: number; fps: number } | null;
  modes: Array<{ width: number; height: number; fps: number; pixelFormat: string }>;
  error?: string;
}


// Local capture signal diagnostics and session-only warning history.
// Alerts are generated from changes in observed health, not from the initial snapshot.
interface CaptureSignalSnapshot {
  checkedAt: string;
  scope: string;
  captures: Array<{
    cameraId: string;
    cameraName: string;
    video: { status: string; frameAgeMs?: number | null; possibleFreezeMs?: number | null;
      identicalFrameMs?: number | null; lastVisualMotionAt?: number | null };
    audio: { status: string; rmsDb?: number | null; audioSampleAgeMs?: number | null;
      audioSamplesObserved?: number; silenceDurationMs?: number | null };
  }>;
}

type SignalAlertKind = "video" | "audio" | "connection";
type SignalAlertLevel = "warning" | "recovered";
interface SignalAlert {
  id: number;
  at: number;
  cameraName: string;
  kind: SignalAlertKind;
  level: SignalAlertLevel;
  message: string;
  acknowledged?: boolean;
  severity?: "warning" | "critical";
}

function videoSignalState(item: CaptureSignalSnapshot["captures"][number]): string {
  if (typeof item.video.possibleFreezeMs === "number" && item.video.possibleFreezeMs > 0) return "possible-freeze";
  return item.video.status;
}
function isVideoWarning(state: string): boolean {
  return state !== "receiving" && state !== "waiting";
}
function isAudioWarning(state: string): boolean {
  return state === "no-audio-samples" || state === "audio-samples-stalled";
}
// Per-node, browser-local rules. Thresholds control dashboard alerting, not FFmpeg capture.
interface SignalAlertRules {
  enabled: boolean;
  freezeWarningSeconds: number;
  staleFrameSeconds: number;
  missingAudioSeconds: number;
  consecutiveChecks: number;
  cooldownSeconds: number;
  alertOnSilence: boolean;
}
const DEFAULT_SIGNAL_RULES: SignalAlertRules = {
  enabled: true, freezeWarningSeconds: 12, staleFrameSeconds: 5,
  missingAudioSeconds: 10, consecutiveChecks: 2, cooldownSeconds: 60,
  alertOnSilence: false
};
function loadSignalRules(nodeId: string): SignalAlertRules {
  try {
    const value = JSON.parse(localStorage.getItem(`tournament-signal-rules:v1:${nodeId}`) || "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_SIGNAL_RULES };
    const rules = { ...DEFAULT_SIGNAL_RULES };
    for (const key of ["freezeWarningSeconds", "staleFrameSeconds", "missingAudioSeconds", "consecutiveChecks", "cooldownSeconds"] as const) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) rules[key] = Math.max(1, Math.min(key === "consecutiveChecks" ? 20 : 3600, value[key]));
    }
    if (typeof value.enabled === "boolean") rules.enabled = value.enabled;
    if (typeof value.alertOnSilence === "boolean") rules.alertOnSilence = value.alertOnSilence;
    return rules;
  } catch { return { ...DEFAULT_SIGNAL_RULES }; }
}
function classifiedSignal(item: CaptureSignalSnapshot["captures"][number], rules: SignalAlertRules): { video: string; audio: string } {
  const freeze = item.video.possibleFreezeMs;
  const age = item.video.frameAgeMs;
  const video = typeof age === "number" && age >= rules.staleFrameSeconds * 1000 ? "stalled" :
    typeof freeze === "number" && freeze >= rules.freezeWarningSeconds * 1000 ? "possible-freeze" : item.video.status;
  const sampleAge = item.audio.audioSampleAgeMs;
  const audio = item.audio.status === "audio-samples-stalled" && typeof sampleAge === "number" && sampleAge < rules.missingAudioSeconds * 1000 ? "audio-active" :
    item.audio.status === "no-audio-samples" && typeof sampleAge === "number" && sampleAge < rules.missingAudioSeconds * 1000 ? "unverified" : item.audio.status;
  return { video, audio };
}
type CameraSignalOverride = { enabled: boolean; freezeWarningSeconds: number | null; staleFrameSeconds: number | null; missingAudioSeconds: number | null; alertOnSilence: boolean | null };
const DEFAULT_CAMERA_OVERRIDE: CameraSignalOverride = { enabled: true, freezeWarningSeconds: null, staleFrameSeconds: null, missingAudioSeconds: null, alertOnSilence: null };
function loadCameraSignalOverrides(nodeId: string): Record<string, CameraSignalOverride> {
  try {
    const stored = JSON.parse(localStorage.getItem(`tournament-camera-signal-rules:v1:${nodeId}`) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const result: Record<string, CameraSignalOverride> = {};
    for (const [id, value] of Object.entries(stored)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Partial<CameraSignalOverride>;
      const numberOrNull = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(3600, Math.floor(n))) : null;
      result[id] = { enabled: candidate.enabled !== false,
        freezeWarningSeconds: numberOrNull(candidate.freezeWarningSeconds),
        staleFrameSeconds: numberOrNull(candidate.staleFrameSeconds),
        missingAudioSeconds: numberOrNull(candidate.missingAudioSeconds),
        alertOnSilence: typeof candidate.alertOnSilence === "boolean" ? candidate.alertOnSilence : null };
    }
    return result;
  } catch { return {}; }
}
function cameraRules(base: SignalAlertRules, override?: CameraSignalOverride): SignalAlertRules {
  if (!override) return base;
  return { ...base, enabled: base.enabled && override.enabled,
    freezeWarningSeconds: override.freezeWarningSeconds ?? base.freezeWarningSeconds,
    staleFrameSeconds: override.staleFrameSeconds ?? base.staleFrameSeconds,
    missingAudioSeconds: override.missingAudioSeconds ?? base.missingAudioSeconds,
    alertOnSilence: override.alertOnSilence ?? base.alertOnSilence };
}
function signalSeverity(kind: SignalAlertKind, state: string): "warning" | "critical" {
  return kind === "connection" || state === "stalled" || state === "no-audio-samples" || state === "audio-samples-stalled" ? "critical" : "warning";
}

interface RecoveryPolicy { enabled: boolean; unhealthyChecks: number; minimumCaptureAgeSeconds: number; protectedStreams: true; }
interface RecoveryCameraStatus {
  cameraId: string; allowed: boolean; reason?: string;
  attemptsInLastHour: number; cooldownRemainingMs: number;
  streaming: boolean; restarting: boolean; recordingEnabled: boolean; lastResult: string | null;
}
interface RecoveryStatus {
  automaticEnabled: boolean; cooldownMinutes: number; maxAttemptsPerHour: number;
  cameras: RecoveryCameraStatus[];
}
interface RecoveryEscalation { cameraId: string; severity: "critical"; failuresInWindow: number; firstFailureAt: string; lastFailureAt: string; unacknowledgedFailures: number; latestDetail: string; incidentStatus: "open" | "resolved"; resolvedAt: string | null; resolutionNote: string | null }
interface RecoveryEscalationResponse { windowMinutes: number; threshold: number; escalations: RecoveryEscalation[] }
interface RecoveryAuditEntry { type: "failure" | "success" | "acknowledged" | "resolved" | "reopened"; cameraId: string; at: string; detail: string }
interface RecoveryEvent { cameraId: string; at: string; outcome: "success" | "failure"; detail: string; acknowledgedAt?: string | null }
const recoveryEventKey = (event: RecoveryEvent) => `${event.at}|${event.cameraId}|${event.outcome}`;

function CaptureRecoveryPanel({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [policy, setPolicy] = useState<RecoveryPolicy | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [audit, setAudit] = useState<RecoveryAuditEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditType, setAuditType] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [statisticsWindow, setStatisticsWindow] = useState<"24h" | "7d" | "30d">("7d");
  // Shared backend rules. Keep edits as a draft until the operator explicitly saves.
  type ReliabilityRules = { minAttempts: number; warningSuccessRate: number; criticalSuccessRate: number; warningFailures: number; criticalFailures: number };
  const [reliabilityRules, setReliabilityRules] = useState<ReliabilityRules>({ minAttempts: 3, warningSuccessRate: 80, criticalSuccessRate: 50, warningFailures: 2, criticalFailures: 4 });
  const [ruleHistory, setRuleHistory] = useState<Array<{ id: string; at: string; before: ReliabilityRules; after: ReliabilityRules; note: string }>>([]);
  const [ruleNote, setRuleNote] = useState("");
  const [importedRules, setImportedRules] = useState<ReliabilityRules | null>(null);
  const [importIntegrityStatus, setImportIntegrityStatus] = useState<string | null>(null);
  // Steps 136-138: Import diagnostics are local operator data, never sent to the backend.
  type ImportDiagnostic = { at: string; fileName: string; bytes: number; outcome: "verified" | "legacy" | "rejected"; checks: string[]; error?: string };
  const [importDiagnostics, setImportDiagnostics] = useState<ImportDiagnostic[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem("tournament-threshold-import-diagnostics-v1") || "[]"); return Array.isArray(raw) ? raw.slice(0, 50) : []; }
    catch { return []; }
  });
  const [diagnosticFilter, setDiagnosticFilter] = useState("all");
  // Milestones 139-143: local-only diagnostic review and portable troubleshooting exports.
  const [diagnosticSearch, setDiagnosticSearch] = useState("");
  const [diagnosticFrom, setDiagnosticFrom] = useState("");
  const [diagnosticTo, setDiagnosticTo] = useState("");
  const [diagnosticSort, setDiagnosticSort] = useState<"newest" | "oldest">("newest");
  // Milestones 144-148: paginated diagnostic review and single-record exports.
  const [diagnosticPageSize, setDiagnosticPageSize] = useState(10);
  const [diagnosticPage, setDiagnosticPage] = useState(1);
  const [diagnosticCopyNotice, setDiagnosticCopyNotice] = useState("");
  // Milestones 149-153: quick navigation, size/error review, and summary exports.
  const [diagnosticMinBytes, setDiagnosticMinBytes] = useState("");
  const [diagnosticMaxBytes, setDiagnosticMaxBytes] = useState("");
  const [diagnosticErrorsOnly, setDiagnosticErrorsOnly] = useState(false);
  const [diagnosticJumpPage, setDiagnosticJumpPage] = useState("1");
  // Steps 154-163: expanded local-only diagnostic navigation, inspection and reports.
  const [diagnosticFileFilter, setDiagnosticFileFilter] = useState("");
  const [diagnosticCheckFilter, setDiagnosticCheckFilter] = useState("");
  const [diagnosticShowChecks, setDiagnosticShowChecks] = useState(true);
  const [diagnosticShowErrors, setDiagnosticShowErrors] = useState(true);
  // Steps 164-173: local review controls. Never send diagnostic history to a capture node.
  const [diagnosticSelected, setDiagnosticSelected] = useState<string[]>([]);
  const [diagnosticPinnedOnly, setDiagnosticPinnedOnly] = useState(false);
  const [diagnosticPinned, setDiagnosticPinned] = useState<string[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem("tournament-threshold-import-pins-v1") || "[]"); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 50) : []; }
    catch { return []; }
  });
  const [diagnosticGroupBy, setDiagnosticGroupBy] = useState<"none" | "outcome" | "filename">("none");
  // Steps 174-183: bulk triage and privacy-safe diagnostic export options.
  const [diagnosticRedactExports, setDiagnosticRedactExports] = useState(false);
  const [diagnosticBulkNotice, setDiagnosticBulkNotice] = useState("");
  // Steps 184-193: local operator annotations, triage and report summaries.
  const [diagnosticNotes, setDiagnosticNotes] = useState<Record<string, string>>(() => {
    try { const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-notes-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length < 1000 && typeof value === "string").map(([key, value]) => [key, String(value).slice(0, 500)]));
    } catch { return {}; }
  });
  // Steps 194-203: browser-local triage status and priority, separate from backend incidents.
  type DiagnosticTriage = { status: "new" | "investigating" | "resolved"; priority: "low" | "normal" | "high" };
  const [diagnosticTriage, setDiagnosticTriage] = useState<Record<string, DiagnosticTriage>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-triage-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => {
        if (key.length > 1000 || !value || typeof value !== "object" || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return ["new", "investigating", "resolved"].includes(String(item.status)) && ["low", "normal", "high"].includes(String(item.priority));
      })) as Record<string, DiagnosticTriage>;
    } catch { return {}; }
  });
  const [diagnosticTriageStatusFilter, setDiagnosticTriageStatusFilter] = useState("all");
  const [diagnosticTriagePriorityFilter, setDiagnosticTriagePriorityFilter] = useState("all");
  const [diagnosticTriageBulkStatus, setDiagnosticTriageBulkStatus] = useState<DiagnosticTriage["status"]>("investigating");
  const [diagnosticTriageBulkPriority, setDiagnosticTriageBulkPriority] = useState<DiagnosticTriage["priority"]>("high");
  function triageFor(key: string): DiagnosticTriage { return diagnosticTriage[key] || { status: "new", priority: "normal" }; }
  function updateDiagnosticTriage(keys: string[], change: Partial<DiagnosticTriage>) {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    setDiagnosticTriage(previous => {
      const next = { ...previous };
      for (const key of keys) {
        if (!valid.has(key)) continue;
        const value = { ...(previous[key] || { status: "new", priority: "normal" }), ...change };
        if (value.status === "new" && value.priority === "normal") delete next[key]; else next[key] = value;
      }
      try { localStorage.setItem("tournament-threshold-import-triage-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Updated triage for ${keys.filter(key => valid.has(key)).length} record(s).`);
  }
  function cleanOrphanedDiagnosticTriage() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticTriage).filter(([key]) => valid.has(key)));
    const removed = Object.keys(diagnosticTriage).length - Object.keys(next).length;
    setDiagnosticTriage(next);
    try { localStorage.setItem("tournament-threshold-import-triage-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${removed} orphaned triage entry/entries.`);
  }
  function exportDiagnosticTriageRecords() {
    const records = filteredImportDiagnostics.map(item => ({ at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName, outcome: item.outcome, ...triageFor(diagnosticKey(item)) }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage-records", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, records }, null, 2), "threshold-import-triage-records.json", "application/json;charset=utf-8");
  }
  // Steps 204-213: operator review shortcuts and portable, browser-local triage reporting.
  const [diagnosticTriageOnlyOpen, setDiagnosticTriageOnlyOpen] = useState(false);
  const [diagnosticTriageOnlyHigh, setDiagnosticTriageOnlyHigh] = useState(false);
  const [diagnosticTriageReportIncludeNotes, setDiagnosticTriageReportIncludeNotes] = useState(false);
  const [diagnosticTriageReportLimit, setDiagnosticTriageReportLimit] = useState(50);
  function selectDiagnosticTriageMatches(predicate: (triage: DiagnosticTriage) => boolean) {
    const keys = filteredImportDiagnostics.filter(item => predicate(triageFor(diagnosticKey(item)))).map(diagnosticKey);
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...keys])));
    setDiagnosticBulkNotice(`Selected ${keys.length} matching triage record(s).`);
  }
  function exportDiagnosticTriageCsv() {
    const rows = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => {
      const t = triageFor(diagnosticKey(item));
      return [item.at, diagnosticRedactExports ? "[redacted]" : item.fileName, item.outcome, t.status, t.priority, diagnosticTriageReportIncludeNotes ? (diagnosticNotes[diagnosticKey(item)] || "") : ""];
    });
    const safe = (value: string) => { const escaped = /^[\s]*[=+@\-]/.test(value) ? "'" + value : value; return '"' + escaped.replace(/"/g, '""') + '"'; };
    downloadDiagnosticFile([["Timestamp", "Filename", "Outcome", "Review status", "Priority", "Operator note"], ...rows].map(row => row.map(safe).join(",")).join("\r\n"), "threshold-import-triage-review.csv", "text/csv;charset=utf-8");
  }
  function exportDiagnosticTriageReviewJson() {
    const records = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage-review", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, totalMatching: filteredImportDiagnostics.length, exported: records.length, records }, null, 2), "threshold-import-triage-review.json", "application/json;charset=utf-8");
  }
  // Steps 214-223: triage age, review queues, and portable review snapshots.
  const [diagnosticReviewAgeDays, setDiagnosticReviewAgeDays] = useState(0);
  const [diagnosticReviewRejectedOnly, setDiagnosticReviewRejectedOnly] = useState(false);
  const [diagnosticReviewMissingNotes, setDiagnosticReviewMissingNotes] = useState(false);
  const [diagnosticReviewSort, setDiagnosticReviewSort] = useState<"chronological" | "priority">("chronological");
  const [diagnosticReviewShowSummary, setDiagnosticReviewShowSummary] = useState(true);
  const diagnosticReviewCutoff = Date.now() - diagnosticReviewAgeDays * 86400000;
  function resetDiagnosticReviewQueue() {
    setDiagnosticReviewAgeDays(0); setDiagnosticReviewRejectedOnly(false); setDiagnosticReviewMissingNotes(false);
    setDiagnosticReviewSort("chronological"); setDiagnosticPage(1);
  }
  function exportDiagnosticReviewSnapshot() {
    const records = filteredImportDiagnostics.slice(0, diagnosticTriageReportLimit).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-review-snapshot", schema: 1,
      exportedAt: new Date().toISOString(), filters: { minAgeDays: diagnosticReviewAgeDays,
      rejectedOnly: diagnosticReviewRejectedOnly, missingNotesOnly: diagnosticReviewMissingNotes,
      order: diagnosticReviewSort }, filenamesRedacted: diagnosticRedactExports,
      totalMatching: filteredImportDiagnostics.length, records }, null, 2),
      "threshold-import-review-snapshot.json", "application/json;charset=utf-8");
  }
  // Steps 224-233: local-only review ownership and overdue queue controls.
  const [diagnosticReviewSlaDays, setDiagnosticReviewSlaDays] = useState(7);
  const [diagnosticReviewOverdueOnly, setDiagnosticReviewOverdueOnly] = useState(false);
  const [diagnosticReviewUnassignedOnly, setDiagnosticReviewUnassignedOnly] = useState(false);
  const [diagnosticReviewOwnerFilter, setDiagnosticReviewOwnerFilter] = useState("");
  const [diagnosticReviewBulkOwner, setDiagnosticReviewBulkOwner] = useState("");
  const [diagnosticReviewOwners, setDiagnosticReviewOwners] = useState<Record<string, string>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("tournament-threshold-import-owners-v1") || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length < 1000 && typeof value === "string" && value.length <= 80)) as Record<string, string>;
    } catch { return {}; }
  });
  function updateDiagnosticOwners(keys: string[], owner: string) {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const cleaned = owner.trim().slice(0, 80);
    setDiagnosticReviewOwners(previous => {
      const next = { ...previous };
      for (const key of keys) {
        if (!valid.has(key)) continue;
        if (cleaned) next[key] = cleaned; else delete next[key];
      }
      try { localStorage.setItem("tournament-threshold-import-owners-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Updated ownership on ${keys.filter(key => valid.has(key)).length} record(s).`);
  }
  function cleanupDiagnosticOwners() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticReviewOwners).filter(([key]) => valid.has(key)));
    setDiagnosticReviewOwners(next);
    try { localStorage.setItem("tournament-threshold-import-owners-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${Object.keys(diagnosticReviewOwners).length - Object.keys(next).length} orphaned owner entry/entries.`);
  }
  function resetDiagnosticOwnershipFilters() {
    setDiagnosticReviewOverdueOnly(false); setDiagnosticReviewUnassignedOnly(false);
    setDiagnosticReviewOwnerFilter(""); setDiagnosticPage(1);
  }
  function exportDiagnosticOverdueQueue() {
    const cutoff = Date.now() - diagnosticReviewSlaDays * 86400000;
    const records = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved" && Date.parse(item.at) <= cutoff).map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, ...triageFor(diagnosticKey(item)), owner: diagnosticReviewOwners[diagnosticKey(item)] || "",
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-overdue-reviews", schema: 1,
      exportedAt: new Date().toISOString(), slaDays: diagnosticReviewSlaDays,
      filenamesRedacted: diagnosticRedactExports, records }, null, 2),
      "threshold-import-overdue-reviews.json", "application/json;charset=utf-8");
  }
  const [diagnosticNotesOnly, setDiagnosticNotesOnly] = useState(false);
  const [diagnosticNoteSearch, setDiagnosticNoteSearch] = useState("");
  const [diagnosticIncludeNotesInExports, setDiagnosticIncludeNotesInExports] = useState(false);
  function saveDiagnosticNote(key: string, note: string) {
    setDiagnosticNotes(previous => {
      const next = { ...previous }; const trimmed = note.slice(0, 500);
      if (trimmed.trim()) next[key] = trimmed; else delete next[key];
      try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  function clearSelectedDiagnosticNotes() {
    const keys = diagnosticSelected.filter(key => diagnosticNotes[key]);
    if (!keys.length || !window.confirm(`Remove operator notes from ${keys.length} selected record(s)?`)) return;
    setDiagnosticNotes(previous => {
      const next = { ...previous }; for (const key of keys) delete next[key];
      try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice(`Cleared ${keys.length} operator note(s).`);
  }
  function pruneOrphanedDiagnosticNotes() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = Object.fromEntries(Object.entries(diagnosticNotes).filter(([key]) => valid.has(key)));
    const removed = Object.keys(diagnosticNotes).length - Object.keys(next).length;
    setDiagnosticNotes(next);
    try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Cleaned ${removed} orphaned operator note(s).`);
  }


  const diagnosticKey = (item: ImportDiagnostic) => JSON.stringify([item.at, item.fileName, item.bytes, item.outcome]);
  function toggleDiagnosticPin(key: string) {
    setDiagnosticPinned(previous => {
      const next = previous.includes(key) ? previous.filter(x => x !== key) : [...previous, key].slice(-50);
      try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  // Steps 244-253: browser-local review queue quick actions and workload snapshots.
  const [reviewFocusOwner, setReviewFocusOwner] = useState("");
  const [reviewFocusPriority, setReviewFocusPriority] = useState<"all" | "high" | "normal" | "low">("all");
  const [reviewFocusStatus, setReviewFocusStatus] = useState<"all" | "new" | "investigating" | "resolved">("all");
  const [reviewFocusOnlyOverdue, setReviewFocusOnlyOverdue] = useState(false);
  const [reviewFocusOnlyUnassigned, setReviewFocusOnlyUnassigned] = useState(false);
  const [reviewFocusSort, setReviewFocusSort] = useState<"age" | "priority">("age");
  const [reviewFocusLimit, setReviewFocusLimit] = useState(25);
  const [reviewFocusIncludeNotes, setReviewFocusIncludeNotes] = useState(false);
  function resetReviewFocus() {
    setReviewFocusOwner(""); setReviewFocusPriority("all"); setReviewFocusStatus("all");
    setReviewFocusOnlyOverdue(false); setReviewFocusOnlyUnassigned(false);
    setReviewFocusSort("age"); setReviewFocusLimit(25);
  }
  function exportReviewFocusSnapshot() {
    const records = reviewFocusRows.slice(0, reviewFocusLimit).map(item => {
      const key = diagnosticKey(item);
      return { at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
        outcome: item.outcome, owner: diagnosticReviewOwners[key] || "", ...triageFor(key),
        ...(reviewFocusIncludeNotes ? { note: diagnosticNotes[key] || "" } : {}) };
    });
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-review-focus", schema: 1,
      exportedAt: new Date().toISOString(), totalMatching: reviewFocusRows.length,
      exportedCount: records.length, filenamesRedacted: diagnosticRedactExports,
      filters: { owner: reviewFocusOwner, priority: reviewFocusPriority, status: reviewFocusStatus,
        overdue: reviewFocusOnlyOverdue, unassigned: reviewFocusOnlyUnassigned,
        sort: reviewFocusSort }, records }, null, 2), "review-focus-snapshot.json", "application/json;charset=utf-8");
  }
  // Steps 254-263: validated, browser-local review filter presets.
  type ReviewPreset = { name: string; owner: string; priority: typeof reviewFocusPriority;
    status: typeof reviewFocusStatus; overdue: boolean; unassigned: boolean;
    sort: typeof reviewFocusSort; limit: number; includeNotes: boolean };
  function validateReviewPreset(input: unknown): ReviewPreset {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Preset must be an object");
    const v = input as Record<string, unknown>;
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 60) throw new Error("Preset name must be 1-60 characters");
    if (typeof v.owner !== "string" || v.owner.length > 80) throw new Error("Owner filter must be at most 80 characters");
    if (!["all", "high", "normal", "low"].includes(String(v.priority))) throw new Error("Invalid priority filter");
    if (!["all", "new", "investigating", "resolved"].includes(String(v.status))) throw new Error("Invalid status filter");
    if (typeof v.overdue !== "boolean" || typeof v.unassigned !== "boolean" || typeof v.includeNotes !== "boolean") throw new Error("Invalid boolean filter");
    if (!["age", "priority"].includes(String(v.sort))) throw new Error("Invalid sort option");
    if (![10, 25, 50].includes(Number(v.limit))) throw new Error("Invalid snapshot limit");
    return v as ReviewPreset;
  }
  const [reviewPresets, setReviewPresets] = useState<ReviewPreset[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem("tournament-review-focus-presets-v1") || "[]");
      return Array.isArray(value) ? value.slice(0, 20).flatMap(item => { try { return [validateReviewPreset(item)]; } catch { return []; } }) : [];
    } catch { return []; }
  });
  const [reviewPresetName, setReviewPresetName] = useState("");
  const [reviewPresetSelected, setReviewPresetSelected] = useState("");
  const [reviewPresetMessage, setReviewPresetMessage] = useState("");
  function persistReviewPresets(next: ReviewPreset[]) {
    setReviewPresets(next);
    try { localStorage.setItem("tournament-review-focus-presets-v1", JSON.stringify(next)); }
    catch { setReviewPresetMessage("Preset updated in memory, but browser storage is unavailable."); }
  }
  function currentReviewPreset(name: string): ReviewPreset {
    return { name, owner: reviewFocusOwner, priority: reviewFocusPriority, status: reviewFocusStatus,
      overdue: reviewFocusOnlyOverdue, unassigned: reviewFocusOnlyUnassigned,
      sort: reviewFocusSort, limit: reviewFocusLimit, includeNotes: reviewFocusIncludeNotes };
  }
  function saveReviewPreset() {
    const name = reviewPresetName.trim();
    try {
      const preset = validateReviewPreset(currentReviewPreset(name));
      const existing = reviewPresets.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (existing && !window.confirm(`Replace saved preset "${existing.name}"?`)) return;
      if (!existing && reviewPresets.length >= 20) throw new Error("Maximum 20 presets. Delete one first.");
      persistReviewPresets([...reviewPresets.filter(item => item.name.toLowerCase() !== name.toLowerCase()), preset]);
      setReviewPresetSelected(name); setReviewPresetMessage(`Saved preset: ${name}`);
    } catch (error) { setReviewPresetMessage(String(error)); }
  }
  function applyReviewPreset() {
    const preset = reviewPresets.find(item => item.name === reviewPresetSelected);
    if (!preset) { setReviewPresetMessage("Choose a saved preset."); return; }
    setReviewFocusOwner(preset.owner); setReviewFocusPriority(preset.priority); setReviewFocusStatus(preset.status);
    setReviewFocusOnlyOverdue(preset.overdue); setReviewFocusOnlyUnassigned(preset.unassigned);
    setReviewFocusSort(preset.sort); setReviewFocusLimit(preset.limit); setReviewFocusIncludeNotes(preset.includeNotes);
    setReviewPresetMessage(`Applied preset: ${preset.name}. No diagnostic records were changed.`);
  }
  function renameReviewPreset() {
    const name = reviewPresetName.trim();
    if (!reviewPresetSelected) return;
    try {
      const selected = reviewPresets.find(item => item.name === reviewPresetSelected);
      if (!selected) throw new Error("Preset not found");
      const renamed = validateReviewPreset({ ...selected, name });
      if (reviewPresets.some(item => item.name.toLowerCase() === name.toLowerCase() && item.name !== selected.name)) throw new Error("A preset already has that name");
      persistReviewPresets(reviewPresets.map(item => item.name === selected.name ? renamed : item));
      setReviewPresetSelected(name); setReviewPresetMessage(`Renamed preset to ${name}`);
    } catch (error) { setReviewPresetMessage(String(error)); }
  }
  function deleteReviewPreset() {
    if (!reviewPresetSelected || !window.confirm(`Delete preset "${reviewPresetSelected}"?`)) return;
    persistReviewPresets(reviewPresets.filter(item => item.name !== reviewPresetSelected));
    setReviewPresetSelected(""); setReviewPresetMessage("Preset deleted. Current filters are unchanged.");
  }
  function exportReviewPresets() {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-review-focus-presets", schema: 1,
      exportedAt: new Date().toISOString(), presets: reviewPresets }, null, 2),
      "review-focus-presets.json", "application/json;charset=utf-8");
  }
  async function importReviewPresets(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 32768) throw new Error("Preset import exceeds 32 KB");
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid preset file");
      const backup = parsed as Record<string, unknown>;
      if (backup.format !== "tournament-review-focus-presets" || backup.schema !== 1 || !Array.isArray(backup.presets)) throw new Error("Unsupported preset format");
      if (backup.presets.length > 20) throw new Error("Import contains more than 20 presets");
      const incoming = backup.presets.map(validateReviewPreset);
      const names = incoming.map(item => item.name.toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Import contains duplicate preset names");
      const merged = [...reviewPresets];
      for (const preset of incoming) {
        const index = merged.findIndex(item => item.name.toLowerCase() === preset.name.toLowerCase());
        if (index >= 0) merged[index] = preset; else merged.push(preset);
      }
      if (merged.length > 20) throw new Error("Import would exceed 20 saved presets");
      if (!window.confirm(`Import ${incoming.length} preset(s)? Matching names will be replaced. No review records will change.`)) return;
      persistReviewPresets(merged); setReviewPresetMessage(`Imported ${incoming.length} preset(s).`);
    } catch (error) { setReviewPresetMessage(`Import rejected: ${String(error)}`); }
  }
  // Steps 234-243: browser-local owner workload and review handoff utilities.
  const [diagnosticOwnerOnlyOpen, setDiagnosticOwnerOnlyOpen] = useState(false);
  const [diagnosticOwnerOnlyHigh, setDiagnosticOwnerOnlyHigh] = useState(false);
  const [diagnosticOwnerOnlyUnnoted, setDiagnosticOwnerOnlyUnnoted] = useState(false);
  const [diagnosticOwnerSort, setDiagnosticOwnerSort] = useState<"existing" | "owner">("existing");
  const [diagnosticOwnerHandoffNote, setDiagnosticOwnerHandoffNote] = useState("");
  function selectOwnerReviewMatches(kind: "assigned" | "unassigned" | "overdue") {
    const cutoff = Date.now() - diagnosticReviewSlaDays * 86400000;
    const matches = filteredImportDiagnostics.filter(item => {
      const key = diagnosticKey(item);
      if (kind === "assigned") return Boolean(diagnosticReviewOwners[key]?.trim());
      if (kind === "unassigned") return !diagnosticReviewOwners[key]?.trim();
      return triageFor(key).status !== "resolved" && Date.parse(item.at) <= cutoff;
    }).map(diagnosticKey);
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...matches])));
    setDiagnosticBulkNotice(`Selected ${matches.length} ${kind} review(s).`);
  }
  function handoffSelectedDiagnosticReviews() {
    const owner = diagnosticReviewBulkOwner.trim();
    const keys = selectedImportDiagnostics.map(diagnosticKey);
    if (!owner || !keys.length) return;
    const note = diagnosticOwnerHandoffNote.trim().slice(0, 500);
    if (!window.confirm(`Assign ${keys.length} selected review(s) to ${owner}?${note ? " Add a handoff note?" : ""}`)) return;
    updateDiagnosticOwners(keys, owner);
    if (note) {
      const valid = new Set(importDiagnostics.map(diagnosticKey));
      setDiagnosticNotes(previous => {
        const next = { ...previous };
        for (const key of keys) if (valid.has(key)) next[key] = [previous[key], `Handoff to ${owner}: ${note}`].filter(Boolean).join(" | ").slice(0, 500);
        try { localStorage.setItem("tournament-threshold-import-notes-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
        return next;
      });
    }
    setDiagnosticOwnerHandoffNote("");
  }
  function exportDiagnosticOwnerWorkload() {
    const records = filteredImportDiagnostics.map(item => ({
      at: item.at, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName,
      outcome: item.outcome, owner: diagnosticReviewOwners[diagnosticKey(item)] || "",
      ...triageFor(diagnosticKey(item)),
      ...(diagnosticTriageReportIncludeNotes ? { operatorNote: diagnosticNotes[diagnosticKey(item)] || "" } : {}),
    }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-owner-workload", schema: 1,
      exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports,
      ownerOnlyOpen: diagnosticOwnerOnlyOpen, ownerOnlyHigh: diagnosticOwnerOnlyHigh,
      ownerOnlyUnnoted: diagnosticOwnerOnlyUnnoted, records }, null, 2),
      "threshold-import-owner-workload.json", "application/json;charset=utf-8");
  }
  const filteredImportDiagnostics = importDiagnostics.filter(item => {
    if (diagnosticFilter !== "all" && item.outcome !== diagnosticFilter) return false;
    if (diagnosticPinnedOnly && !diagnosticPinned.includes(diagnosticKey(item))) return false;
    const triage = triageFor(diagnosticKey(item));
    if (diagnosticTriageStatusFilter !== "all" && triage.status !== diagnosticTriageStatusFilter) return false;
    if (diagnosticTriagePriorityFilter !== "all" && triage.priority !== diagnosticTriagePriorityFilter) return false;
    if (diagnosticTriageOnlyOpen && triage.status === "resolved") return false;
    if (diagnosticTriageOnlyHigh && triage.priority !== "high") return false;
    if (diagnosticReviewAgeDays > 0 && Date.parse(item.at) > diagnosticReviewCutoff) return false;
    if (diagnosticReviewRejectedOnly && item.outcome !== "rejected") return false;
    if (diagnosticReviewMissingNotes && Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())) return false;
    if (diagnosticReviewOverdueOnly && (triage.status === "resolved" || Date.parse(item.at) > Date.now() - diagnosticReviewSlaDays * 86400000)) return false;
    const owner = diagnosticReviewOwners[diagnosticKey(item)] || "";
    if (diagnosticReviewUnassignedOnly && owner.trim()) return false;
    if (diagnosticReviewOwnerFilter.trim() && !owner.toLowerCase().includes(diagnosticReviewOwnerFilter.trim().toLowerCase())) return false;
    if (diagnosticOwnerOnlyOpen && triage.status === "resolved") return false;
    if (diagnosticOwnerOnlyHigh && triage.priority !== "high") return false;
    if (diagnosticOwnerOnlyUnnoted && Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())) return false;
    const note = diagnosticNotes[diagnosticKey(item)] || "";
    if (diagnosticNotesOnly && !note.trim()) return false;
    if (diagnosticNoteSearch.trim() && !note.toLowerCase().includes(diagnosticNoteSearch.trim().toLowerCase())) return false;
    if (diagnosticErrorsOnly && !item.error) return false;
    if (diagnosticFileFilter.trim() && !item.fileName.toLowerCase().includes(diagnosticFileFilter.trim().toLowerCase())) return false;
    if (diagnosticCheckFilter.trim() && !item.checks.some(check => check.toLowerCase().includes(diagnosticCheckFilter.trim().toLowerCase()))) return false;
    if (diagnosticMinBytes !== "" && item.bytes < Number(diagnosticMinBytes)) return false;
    if (diagnosticMaxBytes !== "" && item.bytes > Number(diagnosticMaxBytes)) return false;
    const query = diagnosticSearch.trim().toLowerCase();
    if (query && ![item.fileName, item.outcome, item.error || "", ...item.checks].join(" ").toLowerCase().includes(query)) return false;
    const timestamp = Date.parse(item.at);
    if (!Number.isFinite(timestamp)) return false;
    if (diagnosticFrom && timestamp < new Date(`${diagnosticFrom}T00:00:00`).getTime()) return false;
    if (diagnosticTo && timestamp > new Date(`${diagnosticTo}T23:59:59.999`).getTime()) return false;
    return true;
  }).sort((a, b) => diagnosticSort === "newest" ? Date.parse(b.at) - Date.parse(a.at) : Date.parse(a.at) - Date.parse(b.at));
  if (diagnosticReviewSort === "priority") {
    const weight = { high: 0, normal: 1, low: 2 };
    filteredImportDiagnostics.sort((a, b) => weight[triageFor(diagnosticKey(a)).priority] - weight[triageFor(diagnosticKey(b)).priority] || Date.parse(b.at) - Date.parse(a.at));
  }
  if (diagnosticOwnerSort === "owner") filteredImportDiagnostics.sort((a, b) =>
    (diagnosticReviewOwners[diagnosticKey(a)] || "\uffff").localeCompare(diagnosticReviewOwners[diagnosticKey(b)] || "\uffff") || Date.parse(b.at) - Date.parse(a.at));
  const diagnosticOwnerWorkload = filteredImportDiagnostics.reduce<Record<string, { total: number; open: number; overdue: number; high: number }>>((acc, item) => {
    const key = diagnosticKey(item);
    const owner = diagnosticReviewOwners[key]?.trim() || "(unassigned)";
    const triage = triageFor(key);
    const stats = acc[owner] || { total: 0, open: 0, overdue: 0, high: 0 };
    stats.total += 1;
    if (triage.status !== "resolved") { stats.open += 1; if (Date.parse(item.at) <= Date.now() - diagnosticReviewSlaDays * 86400000) stats.overdue += 1; }
    if (triage.priority === "high") stats.high += 1;
    acc[owner] = stats;
    return acc;
  }, {});
  const reviewFocusRows = filteredImportDiagnostics.filter(item => {
    const key = diagnosticKey(item);
    const owner = diagnosticReviewOwners[key]?.trim() || "";
    const triage = triageFor(key);
    if (reviewFocusOwner && !owner.toLowerCase().includes(reviewFocusOwner.toLowerCase().trim())) return false;
    if (reviewFocusPriority !== "all" && triage.priority !== reviewFocusPriority) return false;
    if (reviewFocusStatus !== "all" && triage.status !== reviewFocusStatus) return false;
    if (reviewFocusOnlyUnassigned && owner) return false;
    if (reviewFocusOnlyOverdue && (triage.status === "resolved" || Date.parse(item.at) > Date.now() - diagnosticReviewSlaDays * 86400000)) return false;
    return true;
  }).sort((a, b) => {
    if (reviewFocusSort === "priority") {
      const rank = { high: 0, normal: 1, low: 2 };
      const delta = rank[triageFor(diagnosticKey(a)).priority] - rank[triageFor(diagnosticKey(b)).priority];
      if (delta) return delta;
    }
    return Date.parse(a.at) - Date.parse(b.at);
  });
  const reviewFocusOpen = reviewFocusRows.filter(item => triageFor(diagnosticKey(item)).status !== "resolved").length;
  const reviewFocusHigh = reviewFocusRows.filter(item => triageFor(diagnosticKey(item)).priority === "high").length;
  const reviewFocusUnassigned = reviewFocusRows.filter(item => !diagnosticReviewOwners[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewOpenCount = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved").length;
  const diagnosticReviewOverdueCount = filteredImportDiagnostics.filter(item => triageFor(diagnosticKey(item)).status !== "resolved" && Date.parse(item.at) <= Date.now() - diagnosticReviewSlaDays * 86400000).length;
  const diagnosticReviewUnassignedCount = filteredImportDiagnostics.filter(item => !diagnosticReviewOwners[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewUnnotedCount = filteredImportDiagnostics.filter(item => !diagnosticNotes[diagnosticKey(item)]?.trim()).length;
  const diagnosticReviewOldest = filteredImportDiagnostics.reduce<number | null>((oldest, item) => {
    const at = Date.parse(item.at); return Number.isFinite(at) && (oldest === null || at < oldest) ? at : oldest;
  }, null);
  const diagnosticGroups = filteredImportDiagnostics.reduce<Record<string, number>>((acc, item) => {
    const group = diagnosticGroupBy === "filename" ? item.fileName : diagnosticGroupBy === "outcome" ? item.outcome : "All";
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});
  const selectedImportDiagnostics = importDiagnostics.filter(item => diagnosticSelected.includes(diagnosticKey(item)));
  const diagnosticSelectedMatching = filteredImportDiagnostics.filter(item => diagnosticSelected.includes(diagnosticKey(item))).length;
  const diagnosticSelectedRejected = selectedImportDiagnostics.filter(item => item.outcome === "rejected").length;
  const diagnosticSelectedPinned = selectedImportDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).length;
  const diagnosticAnnotatedCount = filteredImportDiagnostics.filter(item => Boolean(diagnosticNotes[diagnosticKey(item)]?.trim())).length;
  const diagnosticTriageCounts = filteredImportDiagnostics.reduce<Record<string, number>>((counts, item) => { const t = triageFor(diagnosticKey(item)); counts[`status:${t.status}`] = (counts[`status:${t.status}`] || 0) + 1; counts[`priority:${t.priority}`] = (counts[`priority:${t.priority}`] || 0) + 1; return counts; }, {});
  const diagnosticDays = filteredImportDiagnostics.reduce<Record<string, number>>((acc, item) => { const day = item.at.slice(0, 10); acc[day] = (acc[day] || 0) + 1; return acc; }, {});
  const diagnosticErrorTypes = filteredImportDiagnostics.filter(item => item.error).reduce<Record<string, number>>((acc, item) => { const type = (item.error || "").split(":")[0].slice(0, 80); acc[type] = (acc[type] || 0) + 1; return acc; }, {});
  function exportDiagnosticTriageSummary() {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-triage", schema: 1, exportedAt: new Date().toISOString(), matching: filteredImportDiagnostics.length, annotated: diagnosticAnnotatedCount, byDay: diagnosticDays, byError: diagnosticErrorTypes }, null, 2), "threshold-import-triage.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticNotes() {
    const records = filteredImportDiagnostics.filter(item => diagnosticNotes[diagnosticKey(item)]?.trim()).map(item => ({ at: item.at, outcome: item.outcome, fileName: diagnosticRedactExports ? "[redacted]" : item.fileName, note: diagnosticNotes[diagnosticKey(item)] }));
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-operator-notes", schema: 1, exportedAt: new Date().toISOString(), records }, null, 2), "threshold-import-operator-notes.json", "application/json;charset=utf-8");
  }
  function exportSafeDiagnostic(item: ImportDiagnostic): ImportDiagnostic {
    const note = diagnosticIncludeNotesInExports ? diagnosticNotes[diagnosticKey(item)] : undefined;
    const result = { ...item, ...(note ? { operatorNote: note } : {}), triage: triageFor(diagnosticKey(item)) };
    return (diagnosticRedactExports ? { ...result, fileName: "[redacted]" } : result) as ImportDiagnostic;
  }
  function invertVisibleDiagnosticSelection() {
    const visible = new Set(visibleImportDiagnostics.map(diagnosticKey));
    setDiagnosticSelected(previous => Array.from(new Set([...previous.filter(key => !visible.has(key)), ...visibleImportDiagnostics.filter(item => !previous.includes(diagnosticKey(item))).map(diagnosticKey)])));
  }
  function selectDiagnosticSubset(kind: "rejected" | "pinned") {
    const matches = filteredImportDiagnostics.filter(item => kind === "rejected" ? item.outcome === "rejected" : diagnosticPinned.includes(diagnosticKey(item)));
    setDiagnosticSelected(previous => Array.from(new Set([...previous, ...matches.map(diagnosticKey)])));
    setDiagnosticBulkNotice(`Selected ${matches.length} matching ${kind} record(s).`);
  }
  function unpinSelectedDiagnostics() {
    const selected = new Set(diagnosticSelected);
    setDiagnosticPinned(previous => {
      const next = previous.filter(key => !selected.has(key));
      try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticBulkNotice("Removed pins from selected records.");
  }
  function removeUnpinnedDiagnostics() {
    const pinned = new Set(diagnosticPinned);
    const count = importDiagnostics.filter(item => !pinned.has(diagnosticKey(item))).length;
    if (!count || !window.confirm(`Delete ${count} unpinned diagnostic record(s) from this browser?`)) return;
    setImportDiagnostics(previous => {
      const next = previous.filter(item => pinned.has(diagnosticKey(item)));
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticSelected([]); setDiagnosticPage(1);
    setDiagnosticBulkNotice(`Deleted ${count} unpinned record(s).`);
  }
  function pruneOrphanedDiagnosticPins() {
    const valid = new Set(importDiagnostics.map(diagnosticKey));
    const next = diagnosticPinned.filter(key => valid.has(key));
    const removed = diagnosticPinned.length - next.length;
    setDiagnosticPinned(next);
    try { localStorage.setItem("tournament-threshold-import-pins-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
    setDiagnosticBulkNotice(`Removed ${removed} orphaned pin(s).`);
  }
  function exportSelectedDiagnosticsCsv() {
    if (!selectedImportDiagnostics.length) return;
    const csv = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; };
    const rows = selectedImportDiagnostics.map(exportSafeDiagnostic);
    const lines = [["Timestamp", "File", "Bytes", "Result", "Checks", "Error"].map(csv).join(","), ...rows.map(item => [item.at, item.fileName, item.bytes, item.outcome, item.checks.join("; "), item.error || ""].map(csv).join(","))];
    downloadDiagnosticFile(lines.join("\r\n"), "threshold-import-selected.csv", "text/csv;charset=utf-8");
  }
  function exportPinnedDiagnostics() {
    const rows = importDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).map(exportSafeDiagnostic);
    if (!rows.length) return;
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), pinnedOnly: true, filenamesRedacted: diagnosticRedactExports, records: rows }, null, 2), "threshold-import-pinned.json", "application/json;charset=utf-8");
  }

  function exportSelectedDiagnostics() {
    if (!selectedImportDiagnostics.length) return;
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), selection: true, filenamesRedacted: diagnosticRedactExports, records: selectedImportDiagnostics.map(exportSafeDiagnostic) }, null, 2), "threshold-import-selected.json", "application/json;charset=utf-8");
  }
  function deleteSelectedDiagnostics() {
    if (!selectedImportDiagnostics.length || !window.confirm(`Delete ${selectedImportDiagnostics.length} selected local diagnostic record(s)?`)) return;
    const selected = new Set(diagnosticSelected);
    setImportDiagnostics(previous => {
      const next = previous.filter(item => !selected.has(diagnosticKey(item)));
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
    setDiagnosticSelected([]);
    setDiagnosticPage(1);
  }
  const diagnosticCounts = { verified: filteredImportDiagnostics.filter(x => x.outcome === "verified").length, legacy: filteredImportDiagnostics.filter(x => x.outcome === "legacy").length, rejected: filteredImportDiagnostics.filter(x => x.outcome === "rejected").length };
  const diagnosticPageCount = Math.max(1, Math.ceil(filteredImportDiagnostics.length / diagnosticPageSize));
  const safeDiagnosticPage = Math.min(diagnosticPage, diagnosticPageCount);
  const visibleImportDiagnostics = filteredImportDiagnostics.slice((safeDiagnosticPage - 1) * diagnosticPageSize, safeDiagnosticPage * diagnosticPageSize);
  const diagnosticSuccessPercent = filteredImportDiagnostics.length ? Math.round((diagnosticCounts.verified + diagnosticCounts.legacy) * 100 / filteredImportDiagnostics.length) : null;
  const diagnosticUniqueFiles = new Set(filteredImportDiagnostics.map(item => item.fileName)).size;
  const diagnosticAverageBytes = filteredImportDiagnostics.length ? Math.round(filteredImportDiagnostics.reduce((sum, item) => sum + item.bytes, 0) / filteredImportDiagnostics.length) : null;
  const diagnosticTotalChecks = filteredImportDiagnostics.reduce((sum, item) => sum + item.checks.length, 0);
  const diagnosticLatestAttempt = importDiagnostics.length ? importDiagnostics.reduce((latest, item) => Date.parse(item.at) > Date.parse(latest.at) ? item : latest) : null;
  const diagnosticVisibleStart = filteredImportDiagnostics.length ? (safeDiagnosticPage - 1) * diagnosticPageSize + 1 : 0;
  const diagnosticVisibleEnd = Math.min(safeDiagnosticPage * diagnosticPageSize, filteredImportDiagnostics.length);
  function exportSingleDiagnostic(item: ImportDiagnostic) {
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostic", schema: 1, exportedAt: new Date().toISOString(), filenamesRedacted: diagnosticRedactExports, record: exportSafeDiagnostic(item) }, null, 2), `threshold-import-${item.outcome}-${item.at.replace(/[^0-9A-Za-z]/g, "-")}.json`, "application/json;charset=utf-8");
  }
  async function copySingleDiagnostic(item: ImportDiagnostic) {
    try {
      await navigator.clipboard.writeText([`Time: ${item.at}`, `File: ${item.fileName}`, `Size: ${item.bytes} bytes`, `Result: ${item.outcome}`, ...item.checks.map(check => `Check: ${check}`), ...(item.error ? [`Error: ${item.error}`] : [])].join("\n"));
      setDiagnosticCopyNotice(`Copied details for ${item.fileName}`);
    } catch { setDiagnosticCopyNotice("Clipboard unavailable. Use the individual JSON export instead."); }
  }
  function downloadDiagnosticFile(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportImportDiagnosticsJson() {
    // Include only the already-displayed metadata, never the imported configuration or its contents.
    downloadDiagnosticFile(JSON.stringify({ format: "tournament-threshold-import-diagnostics", schema: 1, exportedAt: new Date().toISOString(), filters: { outcome: diagnosticFilter, search: diagnosticSearch, from: diagnosticFrom, to: diagnosticTo, minBytes: diagnosticMinBytes, maxBytes: diagnosticMaxBytes, errorsOnly: diagnosticErrorsOnly }, summary: diagnosticCounts, filenamesRedacted: diagnosticRedactExports, records: filteredImportDiagnostics.map(exportSafeDiagnostic) }, null, 2), "threshold-import-diagnostics.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticSummary() {
    const count = filteredImportDiagnostics.length;
    const totalBytes = filteredImportDiagnostics.reduce((sum, item) => sum + item.bytes, 0);
    const report = { format: "tournament-threshold-import-diagnostic-summary", schema: 1, exportedAt: new Date().toISOString(), filters: { outcome: diagnosticFilter, search: diagnosticSearch, from: diagnosticFrom, to: diagnosticTo, minBytes: diagnosticMinBytes, maxBytes: diagnosticMaxBytes, errorsOnly: diagnosticErrorsOnly }, totals: { records: count, ...diagnosticCounts, accepted: diagnosticCounts.verified + diagnosticCounts.legacy, acceptancePercent: diagnosticSuccessPercent, totalFileBytes: totalBytes, averageFileBytes: count ? Math.round(totalBytes / count) : null } };
    downloadDiagnosticFile(JSON.stringify(report, null, 2), "threshold-import-summary.json", "application/json;charset=utf-8");
  }
  function exportDiagnosticMarkdown() {
    // Markdown contains metadata only, not imported configuration values.
    const lines = ["# Threshold backup import diagnostic report", "", `Generated: ${new Date().toISOString()}`, `Matching attempts: ${filteredImportDiagnostics.length}`, `Verified: ${diagnosticCounts.verified}`, `Legacy: ${diagnosticCounts.legacy}`, `Rejected: ${diagnosticCounts.rejected}`, `Acceptance: ${diagnosticSuccessPercent === null ? "N/A" : `${diagnosticSuccessPercent}%`}`, "", "## Records", ""];
    for (const item of filteredImportDiagnostics.map(exportSafeDiagnostic)) {
      lines.push(`### ${item.at} | ${item.outcome}`, `File: ${item.fileName.replace(/[\r\n]/g, " ")}`, `Size: ${item.bytes} bytes`, ...(diagnosticIncludeNotesInExports && diagnosticNotes[diagnosticKey(item)] ? [`- Operator note: ${diagnosticNotes[diagnosticKey(item)].replace(/[\r\n]/g, " ")}`] : []), ...item.checks.map(check => `- Passed: ${check.replace(/[\r\n]/g, " ")}`), ...(item.error ? [`- Error: ${item.error.replace(/[\r\n]/g, " ")}`] : []), "");
    }
    downloadDiagnosticFile(lines.join("\n"), "threshold-import-diagnostics.md", "text/markdown;charset=utf-8");
  }
  function recordImportDiagnostic(item: ImportDiagnostic) {
    setImportDiagnostics(previous => {
      const next = [item, ...previous].slice(0, 50);
      try { localStorage.setItem("tournament-threshold-import-diagnostics-v1", JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  function exportImportDiagnostics() {
    const rows = filteredImportDiagnostics.map(exportSafeDiagnostic);
    const csv = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[\s]*[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw; return `"${safe.replace(/"/g, '""')}"`; };
    const content = [["Timestamp", "File", "Bytes", "Result", "Checks", "Error"].map(csv).join(","), ...rows.map(item => [item.at, item.fileName, item.bytes, item.outcome, item.checks.join("; "), item.error ?? ""].map(csv).join(","))].join("\r\n");
    downloadDiagnosticFile(content, "threshold-import-diagnostics.csv", "text/csv;charset=utf-8");
  }

  const [importFileName, setImportFileName] = useState("");
  const [selectedImportFields, setSelectedImportFields] = useState<Array<keyof ReliabilityRules>>([]);
  const [rulesVersion, setRulesVersion] = useState<number | null>(null);
  const [rulesConflict, setRulesConflict] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const rulesDirtyRef = useRef(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesReady, setRulesReady] = useState(false);
  const rulesVersionRef = useRef<number | null>(null);
  useEffect(() => { rulesVersionRef.current = rulesVersion; }, [rulesVersion]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await requestNode("/api/captures/reliability-rules");
        if (!active) return;
        if (!rulesDirtyRef.current) { setReliabilityRules(response.rules); setRulesVersion(response.version); }
        else if (rulesVersionRef.current !== null && response.version !== rulesVersionRef.current) setRulesConflict(true);
        setRulesReady(true);
        try { const historyResponse = await requestNode("/api/captures/reliability-rules/history"); if (active) setRuleHistory(historyResponse.changes ?? []); } catch { /* history is supplementary */ }
        setRulesError(null);
      } catch (error) { if (active) setRulesError(String(error)); }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [requestNode]);
  function editReliabilityRules(next: (previous: ReliabilityRules) => ReliabilityRules) {
    rulesDirtyRef.current = true; setRulesDirty(true); setReliabilityRules(next);
  }
  async function saveReliabilityRules() {
    if (rulesSaving || !rulesReady) return;
    setRulesSaving(true);
    try {
      const response = await requestNode("/api/captures/reliability-rules", { method: "PUT", headers: { "Content-Type": "application/json", "X-Operator-Note": encodeURIComponent(ruleNote.slice(0, 300)) }, body: JSON.stringify({ rules: reliabilityRules, version: rulesVersion }) });
      setReliabilityRules(response.rules); setRulesVersion(response.version); setRulesConflict(false); rulesDirtyRef.current = false; setRulesDirty(false); setRulesError(null); setRuleNote("");
      const historyResponse = await requestNode("/api/captures/reliability-rules/history"); setRuleHistory(historyResponse.changes ?? []);
    } catch (error) { setRulesError(String(error)); if (String(error).includes("409") || String(error).toLowerCase().includes("conflict") || String(error).includes("changed on another dashboard")) setRulesConflict(true); }
    finally { setRulesSaving(false); }
  }
  async function restoreHistoricalRules(changeId: string, snapshot: "before" | "after") {
    if (rulesSaving || rulesVersion === null) return;
    if (rulesDirty && !window.confirm("Discard unsaved threshold edits and restore a historical configuration?")) return;
    if (!window.confirm(`Restore the ${snapshot} configuration from this history entry? This creates a new audited version.`)) return;
    setRulesSaving(true);
    try {
      const response = await requestNode("/api/captures/reliability-rules/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId, snapshot, version: rulesVersion }) });
      setReliabilityRules(response.rules); setRulesVersion(response.version); setRulesConflict(false);
      rulesDirtyRef.current = false; setRulesDirty(false); setRulesError(null); setRuleNote("");
      const historyResponse = await requestNode("/api/captures/reliability-rules/history"); setRuleHistory(historyResponse.changes ?? []);
    } catch (error) {
      setRulesError(String(error));
      if (String(error).includes("409") || String(error).includes("changed on another dashboard")) setRulesConflict(true);
    } finally { setRulesSaving(false); }
  }
  // Step 135: SHA-256 detects accidental changes to the five canonical rule values.
  // It is an integrity checksum, not a digital signature or proof of who created a backup.
  function canonicalReliabilityRules(rules: ReliabilityRules): string {
    return JSON.stringify([rules.minAttempts, rules.warningSuccessRate, rules.criticalSuccessRate, rules.warningFailures, rules.criticalFailures]);
  }
  async function reliabilityRulesChecksum(rules: ReliabilityRules): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable. Use localhost or a secure HTTPS connection.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalReliabilityRules(rules)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  // Step 133/135: Portable JSON backup with verifiable rule-value checksum.
  async function exportReliabilityRules() {
    if (!rulesReady || rulesVersion === null) return;
    try {
      const payload = { format: "tournament-reliability-thresholds", schemaVersion: 2, exportedAt: new Date().toISOString(), sourceVersion: rulesVersion, rules: reliabilityRules, integrity: { algorithm: "SHA-256", checksum: await reliabilityRulesChecksum(reliabilityRules) } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `reliability-thresholds-v${rulesVersion}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setRulesError(`Export failed: ${String(error)}`); }
  }
  function validateImportedRules(value: unknown): ReliabilityRules {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid rules object");
    const data = value as Record<string, unknown>;
    const ranges: Record<keyof ReliabilityRules, [number, number]> = { minAttempts: [1, 100], warningSuccessRate: [0, 100], criticalSuccessRate: [0, 100], warningFailures: [1, 100], criticalFailures: [1, 100] };
    const result = {} as ReliabilityRules;
    for (const key of Object.keys(ranges) as Array<keyof ReliabilityRules>) {
      const n = data[key]; const [min, max] = ranges[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}: expected integer ${min}-${max}`);
      result[key] = n;
    }
    if (result.criticalSuccessRate > result.warningSuccessRate || result.criticalFailures < result.warningFailures) throw new Error("Critical thresholds must be at least as severe as warning thresholds");
    return result;
  }
  async function previewReliabilityImport(file: File | undefined) {
    setImportedRules(null); setImportFileName(""); setSelectedImportFields([]); setImportIntegrityStatus(null); setRulesError(null);
    if (!file) return;
    const checks: string[] = [];
    try {
      if (file.size > 65536) throw new Error("Import file exceeds 64 KB");
      checks.push("File size within 64 KB limit");
      const parsed: unknown = JSON.parse(await file.text());
      checks.push("Valid JSON syntax");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid backup file");
      const backup = parsed as Record<string, unknown>;
      if (backup.format !== "tournament-reliability-thresholds" || (backup.schemaVersion !== 1 && backup.schemaVersion !== 2)) throw new Error("Unsupported backup format or schema version");
      checks.push(`Supported schema version ${backup.schemaVersion}`);
      const validated = validateImportedRules(backup.rules);
      checks.push("All five rule fields valid and thresholds consistent");
      let outcome: ImportDiagnostic["outcome"] = "legacy";
      if (backup.schemaVersion === 2) {
        const integrity = backup.integrity;
        if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) throw new Error("Missing backup integrity information");
        const record = integrity as Record<string, unknown>;
        if (record.algorithm !== "SHA-256" || typeof record.checksum !== "string" || !/^[a-f0-9]{64}$/.test(record.checksum)) throw new Error("Invalid SHA-256 checksum format");
        checks.push("SHA-256 checksum format valid");
        if (await reliabilityRulesChecksum(validated) !== record.checksum) throw new Error("SHA-256 mismatch: backup threshold values were modified or corrupted");
        checks.push("SHA-256 checksum matches rule values");
        outcome = "verified";
        setImportIntegrityStatus("SHA-256 verified: threshold values match the exported checksum. This does not authenticate the backup source.");
      } else {
        checks.push("Legacy backup: no checksum available");
        setImportIntegrityStatus("Legacy backup (schema 1): values validated, but no integrity checksum is available.");
      }
      setImportedRules(validated); setImportFileName(file.name);
      setSelectedImportFields((Object.keys(validated) as Array<keyof ReliabilityRules>).filter(key => validated[key] !== reliabilityRules[key]));
      recordImportDiagnostic({ at: new Date().toISOString(), fileName: file.name, bytes: file.size, outcome, checks });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRulesError(`Import rejected: ${message}`);
      recordImportDiagnostic({ at: new Date().toISOString(), fileName: file.name, bytes: file.size, outcome: "rejected", checks, error: message });
    }
  }
  // Step 134: Restore only selected fields. Validate the merged result before editing.
  const mergedImportRules = importedRules ? ({ ...reliabilityRules, ...Object.fromEntries(selectedImportFields.map(key => [key, importedRules[key]])) } as ReliabilityRules) : null;
  let importMergeError: string | null = null;
  if (mergedImportRules) {
    try { validateImportedRules(mergedImportRules); } catch (error) { importMergeError = String(error); }
  }
  function applyReliabilityImport() {
    if (!mergedImportRules || !selectedImportFields.length || importMergeError || !rulesReady || rulesConflict || rulesSaving) return;
    if (!window.confirm(`Apply ${selectedImportFields.length} selected threshold field(s) to the editor? Shared settings will not change until saved.`)) return;
    editReliabilityRules(() => ({ ...mergedImportRules })); setImportedRules(null); setImportFileName(""); setSelectedImportFields([]);
    setRuleNote(previous => previous || "Selective restoration from threshold backup");
  }
  async function reloadReliabilityRules() {
    try {
      const response = await requestNode("/api/captures/reliability-rules");
      setReliabilityRules(response.rules); setRulesVersion(response.version);
      rulesDirtyRef.current = false; setRulesDirty(false); setRulesConflict(false); setRulesError(null);
    } catch (error) { setRulesError(String(error)); }
  }
  const recoveryStatistics = useMemo(() => {
    const durationMs = statisticsWindow === "24h" ? 86400000 : statisticsWindow === "7d" ? 604800000 : 2592000000;
    const cutoff = Date.now() - durationMs;
    const windowEntries = audit.filter(entry => Number.isFinite(Date.parse(entry.at)) && Date.parse(entry.at) >= cutoff && Date.parse(entry.at) <= Date.now());
    const count = (type: RecoveryAuditEntry["type"]) => windowEntries.filter(entry => entry.type === type).length;
    const successes = count("success");
    const failures = count("failure");
    const cameras = new Map<string, { cameraId: string; successes: number; failures: number }>();
    for (const entry of windowEntries) {
      if (entry.type !== "success" && entry.type !== "failure") continue;
      const camera = cameras.get(entry.cameraId) ?? { cameraId: entry.cameraId, successes: 0, failures: 0 };
      if (entry.type === "success") camera.successes++;
      else camera.failures++;
      cameras.set(entry.cameraId, camera);
    }
    const daily = new Map<string, { day: string; successes: number; failures: number }>();
    for (const entry of windowEntries) {
      if (entry.type !== "success" && entry.type !== "failure") continue;
      const day = new Date(entry.at).toLocaleDateString("en-CA");
      const bucket = daily.get(day) ?? { day, successes: 0, failures: 0 };
      if (entry.type === "success") bucket.successes++;
      else bucket.failures++;
      daily.set(day, bucket);
    }
    return { successes, failures, acknowledged: count("acknowledged"), resolved: count("resolved"), reopened: count("reopened"),
      cameras: [...cameras.values()].sort((a, b) => b.failures - a.failures || a.cameraId.localeCompare(b.cameraId)),
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
      successRate: successes + failures ? Math.round(successes * 1000 / (successes + failures)) / 10 : null };
  }, [audit, statisticsWindow]);
  const reliabilityWarnings = useMemo(() => {
    return recoveryStatistics.cameras.flatMap(camera => {
      const attempts = camera.successes + camera.failures;
      if (attempts < reliabilityRules.minAttempts) return [];
      const rate = camera.successes * 100 / attempts;
      const critical = camera.failures >= reliabilityRules.criticalFailures || rate < reliabilityRules.criticalSuccessRate;
      const warning = camera.failures >= reliabilityRules.warningFailures || rate < reliabilityRules.warningSuccessRate;
      if (!critical && !warning) return [];
      return [{ cameraId: camera.cameraId, severity: critical ? "Critical" : "Warning", attempts, failures: camera.failures, rate: Math.round(rate) }];
    }).sort((a, b) => (a.severity === "Critical" ? 0 : 1) - (b.severity === "Critical" ? 0 : 1) || b.failures - a.failures);
  }, [recoveryStatistics, reliabilityRules]);
  // Browser-local transition history. A new audit attempt (or a changed threshold/window)
  // is required before recording another snapshot; the 10-second poll alone adds nothing.
  type ReliabilityHistoryItem = { at: string; cameraId: string; from: string; to: string; attempts: number; failures: number; rate: number; reason: string };
  const [reliabilityHistory, setReliabilityHistory] = useState<ReliabilityHistoryItem[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("tournament-recovery-warning-history:v1") || "[]");
      return Array.isArray(saved) ? saved.filter((item): item is ReliabilityHistoryItem => !!item && typeof item.cameraId === "string" && typeof item.at === "string" && typeof item.to === "string" && typeof item.from === "string").slice(0, 250) : [];
    } catch { return []; }
  });
  const [sharedWarningsReady, setSharedWarningsReady] = useState(false);
  const reliabilityFingerprint = useMemo(() => JSON.stringify({
    window: statisticsWindow, rules: reliabilityRules,
    attempts: audit.filter(entry => entry.type === "failure" || entry.type === "success")
      .map(entry => `${entry.at}|${entry.cameraId}|${entry.type}`).sort()
  }), [audit, statisticsWindow, reliabilityRules]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await requestNode("/api/captures/reliability-warnings");
        if (!active) return;
        const entries = Array.isArray(response.events) ? response.events : [];
        setReliabilityHistory(entries.map((e: any) => ({ at: e.at, cameraId: e.cameraId, from: e.from, to: e.to, attempts: e.attempts, failures: e.failures, rate: e.rate, reason: e.reason })));
        setReliabilityReviews(Object.fromEntries(entries.filter((e: any) => e.acknowledgedAt).map((e: any) => [e.key, { acknowledgedAt: e.acknowledgedAt, note: e.note }] )));
        setSharedWarningsReady(true);
      } catch { if (active) setSharedWarningsReady(false); }
    };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [requestNode]);
  const reliabilityPrevious = useRef<{ fingerprint: string; states: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!audit.length) return;
    const current: Record<string, string> = {};
    for (const camera of recoveryStatistics.cameras) current[camera.cameraId] = "Normal";
    for (const warning of reliabilityWarnings) current[warning.cameraId] = warning.severity;
    const previous = reliabilityPrevious.current;
    if (previous?.fingerprint === reliabilityFingerprint) return;
    reliabilityPrevious.current = { fingerprint: reliabilityFingerprint, states: current };
    // The first observation establishes a baseline rather than inventing a transition.
    if (!previous) return;
    const changes: ReliabilityHistoryItem[] = [];
    for (const cameraId of new Set([...Object.keys(previous.states), ...Object.keys(current)])) {
      const from = previous.states[cameraId] ?? "Normal";
      const to = current[cameraId] ?? "Normal";
      if (from === to) continue;
      const warning = reliabilityWarnings.find(item => item.cameraId === cameraId);
      changes.push({ at: new Date().toISOString(), cameraId, from, to,
        attempts: warning?.attempts ?? 0, failures: warning?.failures ?? 0, rate: warning?.rate ?? 0,
        reason: to === "Normal" ? "Returned below warning thresholds or left reporting window" :
          to === "Critical" && from === "Warning" ? "Escalated from warning to critical" : "Threshold state changed" });
    }
    if (changes.length && sharedWarningsReady) {
      void Promise.all(changes.map(change => requestNode("/api/captures/reliability-warnings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) })))
        .then(() => requestNode("/api/captures/reliability-warnings"))
        .then(response => { setReliabilityHistory((response.events ?? []).map((e: any) => ({ at: e.at, cameraId: e.cameraId, from: e.from, to: e.to, attempts: e.attempts, failures: e.failures, rate: e.rate, reason: e.reason }))); })
        .catch(error => setError(String(error)));
    }
  }, [reliabilityFingerprint, reliabilityWarnings, recoveryStatistics.cameras, audit.length, sharedWarningsReady]);
  useEffect(() => {
    try { localStorage.setItem("tournament-recovery-warning-history:v1", JSON.stringify(reliabilityHistory)); }
    catch { /* storage unavailable */ }
  }, [reliabilityHistory]);
  // Step 127: browser-local operator reviews, keyed to immutable warning transition identity.
  type ReliabilityReview = { acknowledgedAt: string; note: string };
  const [reliabilityReviews, setReliabilityReviews] = useState<Record<string, ReliabilityReview>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("tournament-recovery-warning-reviews:v1") || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => {
        const review = value as Partial<ReliabilityReview> | null;
        return review && typeof review.acknowledgedAt === "string" && typeof review.note === "string";
      })) as Record<string, ReliabilityReview>;
    } catch { return {}; }
  });
  const reliabilityReviewKey = (item: ReliabilityHistoryItem) => JSON.stringify([item.at, item.cameraId, item.from, item.to]);
  useEffect(() => {
    try { localStorage.setItem("tournament-recovery-warning-reviews:v1", JSON.stringify(reliabilityReviews)); }
    catch { /* storage unavailable */ }
  }, [reliabilityReviews]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [historyReviewFilter, setHistoryReviewFilter] = useState("all");
  async function acknowledgeReliabilityWarning(item: ReliabilityHistoryItem) {
    const key = reliabilityReviewKey(item);
    if (reliabilityReviews[key]) return;
    const note = (reviewNotes[key] || "").trim();
    if (!note || note.length > 1000) return;
    try {
      const response = await requestNode("/api/captures/reliability-warnings/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, note }) });
      setReliabilityReviews(previous => ({ ...previous, [key]: { acknowledgedAt: response.event.acknowledgedAt, note: response.event.note } }));
      setReviewNotes(previous => { const next = { ...previous }; delete next[key]; return next; });
    } catch (error) { setError(String(error)); }
  }
  const [historyFilter, setHistoryFilter] = useState("all");
  const visibleReliabilityHistory = reliabilityHistory.filter(item => (historyFilter === "all" || item.to === historyFilter) && (historyReviewFilter === "all" || (historyReviewFilter === "reviewed" ? !!reliabilityReviews[reliabilityReviewKey(item)] : !reliabilityReviews[reliabilityReviewKey(item)])));
  function exportReliabilityHistory() {
    const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [["Timestamp", "Camera", "Previous state", "New state", "Attempts", "Failures", "Success rate (%)", "Reason", "Acknowledged at", "Operator note"],
      ...visibleReliabilityHistory.map(item => [item.at, item.cameraId, item.from, item.to, item.attempts, item.failures, item.rate, item.reason, reliabilityReviews[reliabilityReviewKey(item)]?.acknowledgedAt ?? "", reliabilityReviews[reliabilityReviewKey(item)]?.note ?? ""])];
    const blob = new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `recovery-reliability-warnings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filteredAudit = audit.filter(entry => {
    const search = auditSearch.trim().toLowerCase();
    const timestamp = Date.parse(entry.at);
    return (auditType === "all" || entry.type === auditType) &&
      (!search || `${entry.cameraId} ${entry.type} ${entry.detail}`.toLowerCase().includes(search)) &&
      (!auditFrom || (Number.isFinite(timestamp) && timestamp >= new Date(`${auditFrom}T00:00:00`).getTime())) &&
      (!auditTo || (Number.isFinite(timestamp) && timestamp <= new Date(`${auditTo}T23:59:59.999`).getTime()));
  });
  function exportAuditCsv() {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [["Timestamp", "Camera ID", "Event Type", "Detail"],
      ...filteredAudit.map(entry => [entry.at, entry.cameraId, entry.type, entry.detail])];
    const csv = "\uFEFF" + rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `capture-recovery-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const [escalations, setEscalations] = useState<RecoveryEscalationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const refresh = async () => {
    try {
      const [nextStatus, nextEvents, nextPolicy, nextEscalations, nextAudit] = await Promise.all([
        requestNode("/api/captures/recovery-status"),
        requestNode("/api/captures/recovery-events"),
        requestNode("/api/captures/recovery-policy"), requestNode("/api/captures/recovery-escalations"), requestNode("/api/captures/recovery-audit")
      ]);
      setStatus(nextStatus); setEvents(nextEvents.events ?? []); setPolicy(nextPolicy); setEscalations(nextEscalations); setAudit(nextAudit.events ?? []);
      setError(null); setLastUpdate(new Date().toLocaleTimeString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [s, e, p, x, auditResponse] = await Promise.all([
          requestNode("/api/captures/recovery-status"), requestNode("/api/captures/recovery-events"), requestNode("/api/captures/recovery-policy"), requestNode("/api/captures/recovery-escalations"), requestNode("/api/captures/recovery-audit")
        ]);
        if (alive) { setStatus(s); setEvents(e.events ?? []); setPolicy(p); setEscalations(x); setAudit(auditResponse.events ?? []); setError(null); setLastUpdate(new Date().toLocaleTimeString()); }
      } catch (cause) { if (alive) setError(String(cause)); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [requestNode]);
  async function restart(camera: RecoveryCameraStatus) {
    if (!window.confirm(`Restart capture for ${camera.cameraId}? This stops capture and starts a new recording segment. Active YouTube streams are protected.`)) return;
    setBusy(camera.cameraId);
    try {
      await requestNode(`/api/captures/${encodeURIComponent(camera.cameraId)}/recover`, { method: "POST" });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function resolveIncident(cameraId: string) {
    const note = window.prompt(`Resolution note for ${cameraId} (required):`);
    if (!note?.trim()) return;
    setBusy(`resolve:${cameraId}`);
    try {
      await requestNode(`/api/captures/recovery-incidents/${encodeURIComponent(cameraId)}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note.trim() })
      });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function acknowledgeFailures(keys: string[]) {
    if (!keys.length) return;
    setBusy("acknowledge");
    try {
      await requestNode("/api/captures/recovery-events/acknowledge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys })
      });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  async function updatePolicy() {
    if (!policy || savingPolicy) return;
    if (policy.enabled && !window.confirm("Enable unattended camera capture restarts? Recording segments may split. Active YouTube streams remain protected.")) return;
    setSavingPolicy(true);
    try {
      const saved = await requestNode("/api/captures/recovery-policy", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy)
      });
      setPolicy(saved);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSavingPolicy(false); }
  }
  return <section className="overview" aria-label="Capture recovery controls">
    <h2>Capture Recovery</h2>
    <p className="muted">Manual restarts are restricted by stream protection, cooldowns, and attempt limits. Automatic recovery is {status?.automaticEnabled ? "enabled" : "disabled"}.</p>
    <details className="compact-collapsible"><summary>Automatic recovery policy</summary>
      {policy && <div className="bulk-results">
        <label><input type="checkbox" checked={policy.enabled} onChange={e => setPolicy({ ...policy, enabled: e.target.checked })} /> Enable unattended recovery</label>
        <label>Consecutive unhealthy checks <input type="number" min={3} max={12} value={policy.unhealthyChecks} onChange={e => setPolicy({ ...policy, unhealthyChecks: Number(e.target.value) })} /></label>
        <label>Minimum capture age (seconds) <input type="number" min={30} max={600} value={policy.minimumCaptureAgeSeconds} onChange={e => setPolicy({ ...policy, minimumCaptureAgeSeconds: Number(e.target.value) })} /></label>
        <p className="muted">YouTube streams are always protected. Recovery remains limited to two attempts per hour per camera with a five-minute cooldown.</p>
        <button type="button" disabled={savingPolicy} onClick={() => void updatePolicy()}>{savingPolicy ? "Saving..." : "Save recovery policy"}</button>
      </div>}
    </details>
    <button type="button" onClick={() => void refresh()}>Refresh recovery status</button>
    {lastUpdate && <span className="muted"> Updated: {lastUpdate}</span>}
    {error && <p role="alert">{error}</p>}
    {status?.cameras.length === 0 && <p>No active captures.</p>}
    {status?.cameras.map(camera => <div className="bulk-results" key={camera.cameraId}>
      <p><strong>{camera.cameraId}</strong></p>
      <p>Status: {camera.restarting ? "Restarting" : camera.streaming ? "Streaming (protected)" : camera.allowed ? "Eligible for restart" : camera.reason || "Unavailable"}</p>
      <p>Recovery attempts (last hour): {camera.attemptsInLastHour} / {status.maxAttemptsPerHour} | Cooldown: {Math.ceil(camera.cooldownRemainingMs / 1000)}s | Recording: {camera.recordingEnabled ? "On" : "Off"}</p>
      {camera.lastResult && <p>{camera.lastResult}</p>}
      <button type="button" disabled={!camera.allowed || busy !== null} onClick={() => void restart(camera)}>{busy === camera.cameraId ? "Restarting..." : "Restart capture"}</button>
    </div>)}
    <details className="compact-collapsible"><summary>Repeated-failure escalation ({escalations?.escalations.filter(item => item.incidentStatus === "open").length ?? 0} open)</summary>
      <p className="muted">A critical escalation appears after {escalations?.threshold ?? 3} failed recovery attempts for one camera within {escalations?.windowMinutes ?? 60} minutes. This is monitoring only and never bypasses stream protection or restart limits.</p>
      {escalations?.escalations.map(item => <div className="bulk-results" key={item.cameraId} role="alert">
        <p><strong>{item.incidentStatus === "resolved" ? "Resolved" : "Critical"}: {item.cameraId}</strong> | {item.failuresInWindow} failures in the last hour</p>
        <p>First: {new Date(item.firstFailureAt).toLocaleString()} | Latest: {new Date(item.lastFailureAt).toLocaleString()} | Unacknowledged: {item.unacknowledgedFailures}</p>
        <p>{item.latestDetail}</p>
        {item.incidentStatus === "resolved" ? <p className="muted">Resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : ""}: {item.resolutionNote}. A new failure will reopen this incident.</p> :
          <button type="button" disabled={busy !== null} onClick={() => void resolveIncident(item.cameraId)}>{busy === `resolve:${item.cameraId}` ? "Resolving..." : "Resolve incident"}</button>}
      </div>)}
      {escalations && escalations.escalations.length === 0 && <p>No cameras currently meet the escalation threshold.</p>}
    </details>
    <details className="compact-collapsible"><summary>Operator notifications ({events.filter(e => e.outcome === "failure" && !e.acknowledgedAt).length} unacknowledged)</summary>
      <p className="muted">Acknowledgement marks a failed restart as reviewed. It does not restart cameras or change recovery safeguards.</p>
      {events.some(e => e.outcome === "failure" && !e.acknowledgedAt) && <button type="button" disabled={busy !== null} onClick={() => void acknowledgeFailures(events.filter(e => e.outcome === "failure" && !e.acknowledgedAt).map(recoveryEventKey))}>Acknowledge all failures</button>}
      {events.filter(e => e.outcome === "failure").slice(0, 25).map((event, i) => <div className="bulk-results" key={`${recoveryEventKey(event)}-${i}`}>
        <p>{new Date(event.at).toLocaleString()}: {event.cameraId}: {event.detail}</p>
        {event.acknowledgedAt ? <p className="muted">Acknowledged {new Date(event.acknowledgedAt).toLocaleString()}</p> :
          <button type="button" disabled={busy !== null} onClick={() => void acknowledgeFailures([recoveryEventKey(event)])}>Acknowledge</button>}
      </div>)}
      {!events.some(e => e.outcome === "failure") && <p>No recovery failures recorded.</p>}
    </details>
    <details className="compact-collapsible"><summary>Recovery incident statistics and reliability trends</summary>
      <p className="muted">Statistics use retained audit records only (up to 2,000 events), not continuous camera uptime. Success rate measures recovery attempts, not stream availability. Older records may have been pruned.</p>
      <label>Reporting period <select value={statisticsWindow} onChange={e => setStatisticsWindow(e.target.value as "24h" | "7d" | "30d")}>
        <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
      </select></label>
      <div className="bulk-results">
        <p><strong>Recovery attempts:</strong> {recoveryStatistics.successes + recoveryStatistics.failures} | <strong>Successful:</strong> {recoveryStatistics.successes} | <strong>Failed:</strong> {recoveryStatistics.failures}</p>
        <p><strong>Attempt success rate:</strong> {recoveryStatistics.successRate === null ? "N/A (no attempts)" : `${recoveryStatistics.successRate}%`}</p>
        <p><strong>Acknowledgements:</strong> {recoveryStatistics.acknowledged} | <strong>Resolutions:</strong> {recoveryStatistics.resolved} | <strong>Reopenings:</strong> {recoveryStatistics.reopened}</p>
      </div>
      <details className="compact-collapsible"><summary>Proactive reliability warnings ({reliabilityWarnings.length})</summary>
        <p className="muted">Warnings use retained recovery-attempt audit events in the selected reporting period. They are informational and never trigger camera restarts. Thresholds are shared through the backend. Save changes to synchronize dashboards.</p>
        <div className="bulk-results">
          <label>Minimum attempts before evaluation <input type="number" min={1} max={100} value={reliabilityRules.minAttempts} onChange={e => editReliabilityRules(r => ({ ...r, minAttempts: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
          <label>Warning below success rate (%) <input type="number" min={0} max={100} value={reliabilityRules.warningSuccessRate} onChange={e => editReliabilityRules(r => ({ ...r, warningSuccessRate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} /></label>
          <label>Critical below success rate (%) <input type="number" min={0} max={100} value={reliabilityRules.criticalSuccessRate} onChange={e => editReliabilityRules(r => ({ ...r, criticalSuccessRate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} /></label>
          <label>Warning at failed attempts <input type="number" min={1} max={100} value={reliabilityRules.warningFailures} onChange={e => editReliabilityRules(r => ({ ...r, warningFailures: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
          <label>Critical at failed attempts <input type="number" min={1} max={100} value={reliabilityRules.criticalFailures} onChange={e => editReliabilityRules(r => ({ ...r, criticalFailures: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))} /></label>
        </div>
        <label>Change reason (optional) <input type="text" maxLength={300} value={ruleNote} onChange={e => setRuleNote(e.target.value)} placeholder="Reason for threshold change" /></label>
        <button type="button" disabled={!rulesDirty || rulesSaving || !rulesReady || rulesConflict || rulesVersion === null} onClick={() => void saveReliabilityRules()}>{rulesSaving ? "Saving..." : "Save shared thresholds"}</button>
        <p className="muted">Shared configuration version: {rulesVersion ?? "loading"}</p>
        {rulesConflict && <p role="alert">Another dashboard changed these thresholds. Reload shared settings to resolve the conflict. Your unsaved draft will be discarded.</p>}
        <button type="button" onClick={() => void reloadReliabilityRules()} disabled={rulesSaving}>Reload shared thresholds</button>
        {rulesDirty && <p className="muted">Unsaved changes are visible only here until saved.</p>}
        {rulesError && <p role="alert">Threshold sync: {rulesError}</p>}
        {!rulesReady && <p className="muted">Loading shared thresholds...</p>}
        <details className="compact-collapsible"><summary>Threshold backup and import/export</summary>
          <p className="muted">Export the current editor values with a SHA-256 integrity checksum. Imports verify schema 2 checksums; legacy schema 1 backups are accepted but unverified. A checksum does not prove the backup is trusted. Importing previews and validates a backup without modifying shared settings. Apply to the editor, then save using the current configuration version.</p>
          <button type="button" disabled={!rulesReady || rulesVersion === null} onClick={() => void exportReliabilityRules()}>Export threshold JSON</button>
          <label>Import threshold JSON <input type="file" accept=".json,application/json" onChange={e => void previewReliabilityImport(e.target.files?.[0])} /></label>
          <details className="compact-collapsible"><summary>Backup validation diagnostics ({importDiagnostics.length})</summary>
            <p className="muted">Steps 136-138: View validation checkpoints, failure reasons and recent import attempts. This browser retains the latest 50 attempts, including file names. No file contents are stored. History is local to this browser and is not an authenticated audit trail.</p>
            <p className="muted">Operator review tools: pinned records and selection are local to this browser. Pins are bookmarks, not immutable audit records.</p>
            <label><input type="checkbox" checked={diagnosticPinnedOnly} onChange={e => { setDiagnosticPinnedOnly(e.target.checked); setDiagnosticPage(1); }} /> Pinned only</label>
            <label>Group summary <select value={diagnosticGroupBy} onChange={e => setDiagnosticGroupBy(e.target.value as "none" | "outcome" | "filename")}><option value="none">All records</option><option value="outcome">By outcome</option><option value="filename">By filename</option></select></label>
            {diagnosticGroupBy !== "none" && <div className="bulk-results">{Object.entries(diagnosticGroups).sort((a, b) => b[1] - a[1]).map(([group, count]) => <p key={group}>{group}: {count}</p>)}</div>}
            <p className="muted">Selected: {selectedImportDiagnostics.length} | Pinned: {importDiagnostics.filter(item => diagnosticPinned.includes(diagnosticKey(item))).length}</p>
            <p className="muted">Selected matching filters: {diagnosticSelectedMatching} | Selected rejected: {diagnosticSelectedRejected} | Selected pinned: {diagnosticSelectedPinned}</p>
            <details className="compact-collapsible"><summary>Operator triage and priority</summary>
              <p className="muted">Browser-local review labels only. These do not resolve backend incidents or change stream health.</p>
              <label>Status filter <select value={diagnosticTriageStatusFilter} onChange={e => { setDiagnosticTriageStatusFilter(e.target.value); setDiagnosticPage(1); }}><option value="all">All statuses</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <label>Priority filter <select value={diagnosticTriagePriorityFilter} onChange={e => { setDiagnosticTriagePriorityFilter(e.target.value); setDiagnosticPage(1); }}><option value="all">All priorities</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <p className="muted">Matching triage: New {diagnosticTriageCounts["status:new"] || 0} | Investigating {diagnosticTriageCounts["status:investigating"] || 0} | Resolved {diagnosticTriageCounts["status:resolved"] || 0} | High priority {diagnosticTriageCounts["priority:high"] || 0}</p>
              <label><input type="checkbox" checked={diagnosticTriageOnlyOpen} onChange={e => { setDiagnosticTriageOnlyOpen(e.target.checked); setDiagnosticPage(1); }} /> Open reviews only (204)</label>
              <label><input type="checkbox" checked={diagnosticTriageOnlyHigh} onChange={e => { setDiagnosticTriageOnlyHigh(e.target.checked); setDiagnosticPage(1); }} /> High-priority reviews only (205)</label>
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.status === "new")}>Select new reviews (206)</button>{" "}
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.status === "investigating")}>Select investigating (207)</button>{" "}
              <button type="button" onClick={() => selectDiagnosticTriageMatches(t => t.priority === "high")}>Select high priority (208)</button>{" "}
              <button type="button" onClick={() => { setDiagnosticTriageOnlyOpen(true); setDiagnosticTriageOnlyHigh(true); setDiagnosticPage(1); }}>Focus open high-priority (209)</button>{" "}
              <button type="button" onClick={() => { setDiagnosticTriageOnlyOpen(false); setDiagnosticTriageOnlyHigh(false); setDiagnosticTriageStatusFilter("all"); setDiagnosticTriagePriorityFilter("all"); setDiagnosticPage(1); }}>Reset triage filters (210)</button>
              <label>Review export limit (211) <select value={diagnosticTriageReportLimit} onChange={e => setDiagnosticTriageReportLimit(Number(e.target.value))}><option value={10}>10 records</option><option value={25}>25 records</option><option value={50}>50 records</option></select></label>
              <label><input type="checkbox" checked={diagnosticTriageReportIncludeNotes} onChange={e => setDiagnosticTriageReportIncludeNotes(e.target.checked)} /> Include operator notes in review exports (212)</label>
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageCsv}>Export review CSV (213)</button>{" "}
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageReviewJson}>Export review JSON</button>
              <details className="compact-collapsible"><summary>Review queue and aging (214-223)</summary>
                <p className="muted">Review aging uses the import timestamp, not the time a triage label was changed. All data remains browser-local.</p>
                <label>Minimum record age (214) <select value={diagnosticReviewAgeDays} onChange={e => { setDiagnosticReviewAgeDays(Number(e.target.value)); setDiagnosticPage(1); }}><option value={0}>Any age</option><option value={1}>1+ days</option><option value={7}>7+ days</option><option value={30}>30+ days</option></select></label>
                <label><input type="checkbox" checked={diagnosticReviewRejectedOnly} onChange={e => { setDiagnosticReviewRejectedOnly(e.target.checked); setDiagnosticPage(1); }} /> Rejected imports only (215)</label>
                <label><input type="checkbox" checked={diagnosticReviewMissingNotes} onChange={e => { setDiagnosticReviewMissingNotes(e.target.checked); setDiagnosticPage(1); }} /> Without operator notes (216)</label>
                <label>Review order (217) <select value={diagnosticReviewSort} onChange={e => { setDiagnosticReviewSort(e.target.value as "chronological" | "priority"); setDiagnosticPage(1); }}><option value="chronological">Existing chronological order</option><option value="priority">High priority first, newest within priority</option></select></label>
                <label><input type="checkbox" checked={diagnosticReviewShowSummary} onChange={e => setDiagnosticReviewShowSummary(e.target.checked)} /> Show queue summary (218)</label>
                {diagnosticReviewShowSummary && <p className="muted">Open reviews: {diagnosticReviewOpenCount} (219) | Without notes: {diagnosticReviewUnnotedCount} (220) | Oldest matching import: {diagnosticReviewOldest === null ? "None" : new Date(diagnosticReviewOldest).toLocaleString()} (221)</p>}
                <details className="compact-collapsible"><summary>Review ownership and overdue queue (224-233)</summary>
                  <label>Review overdue after (224) <select value={diagnosticReviewSlaDays} onChange={e => { setDiagnosticReviewSlaDays(Number(e.target.value)); setDiagnosticPage(1); }}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
                  <label><input type="checkbox" checked={diagnosticReviewOverdueOnly} onChange={e => { setDiagnosticReviewOverdueOnly(e.target.checked); setDiagnosticPage(1); }} /> Overdue open reviews only (225)</label>
                  <label><input type="checkbox" checked={diagnosticReviewUnassignedOnly} onChange={e => { setDiagnosticReviewUnassignedOnly(e.target.checked); setDiagnosticPage(1); }} /> Unassigned reviews only (226)</label>
                  <label>Owner name filter (227) <input type="search" value={diagnosticReviewOwnerFilter} onChange={e => { setDiagnosticReviewOwnerFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Search owner" /></label>
                  <p className="muted">Matching overdue open reviews: {diagnosticReviewOverdueCount} (228) | Unassigned: {diagnosticReviewUnassignedCount} (229). Overdue age is measured from import time.</p>
                  <label>Assign selected to (230) <input type="text" maxLength={80} value={diagnosticReviewBulkOwner} onChange={e => setDiagnosticReviewBulkOwner(e.target.value)} placeholder="Operator name" /></label>
                  <button type="button" disabled={!selectedImportDiagnostics.length || !diagnosticReviewBulkOwner.trim()} onClick={() => updateDiagnosticOwners(selectedImportDiagnostics.map(diagnosticKey), diagnosticReviewBulkOwner)}>Assign selected</button>{" "}
                  <button type="button" disabled={!selectedImportDiagnostics.some(item => diagnosticReviewOwners[diagnosticKey(item)])} onClick={() => { if (window.confirm("Clear owners on selected records?")) updateDiagnosticOwners(selectedImportDiagnostics.map(diagnosticKey), ""); }}>Clear selected owners (231)</button>{" "}
                  <button type="button" onClick={resetDiagnosticOwnershipFilters}>Reset ownership filters (232)</button>{" "}
                  <button type="button" disabled={!diagnosticReviewOverdueCount} onClick={exportDiagnosticOverdueQueue}>Export overdue JSON (233)</button>{" "}
                  <button type="button" onClick={cleanupDiagnosticOwners}>Clean orphaned owners</button>
                  <details className="compact-collapsible"><summary>Owner workload and handoff (234-243)</summary>
                    <label><input type="checkbox" checked={diagnosticOwnerOnlyOpen} onChange={e => { setDiagnosticOwnerOnlyOpen(e.target.checked); setDiagnosticPage(1); }} /> Open reviews only (234)</label>
                    <label><input type="checkbox" checked={diagnosticOwnerOnlyHigh} onChange={e => { setDiagnosticOwnerOnlyHigh(e.target.checked); setDiagnosticPage(1); }} /> High-priority only (235)</label>
                    <label><input type="checkbox" checked={diagnosticOwnerOnlyUnnoted} onChange={e => { setDiagnosticOwnerOnlyUnnoted(e.target.checked); setDiagnosticPage(1); }} /> Missing notes only (236)</label>
                    <label>Owner sort (237) <select value={diagnosticOwnerSort} onChange={e => { setDiagnosticOwnerSort(e.target.value as "existing" | "owner"); setDiagnosticPage(1); }}><option value="existing">Existing order</option><option value="owner">Owner A-Z, unassigned last</option></select></label>
                    <button type="button" onClick={() => selectOwnerReviewMatches("assigned")}>Select assigned (238)</button>{" "}
                    <button type="button" onClick={() => selectOwnerReviewMatches("unassigned")}>Select unassigned (239)</button>{" "}
                    <button type="button" onClick={() => selectOwnerReviewMatches("overdue")}>Select overdue (240)</button>
                    <p className="muted">Workload by owner (241). Counts reflect current filters; overdue uses the selected review age threshold.</p>
                    {Object.entries(diagnosticOwnerWorkload).sort(([a], [b]) => a.localeCompare(b)).map(([owner, counts]) => <p key={owner} className="muted"><strong>{owner}</strong>: {counts.total} total, {counts.open} open, {counts.overdue} overdue, {counts.high} high priority</p>)}
                    <label>Handoff note (242) <input type="text" maxLength={500} value={diagnosticOwnerHandoffNote} onChange={e => setDiagnosticOwnerHandoffNote(e.target.value)} placeholder="Optional note for selected reviews" /></label>
                    <button type="button" disabled={!selectedImportDiagnostics.length || !diagnosticReviewBulkOwner.trim()} onClick={handoffSelectedDiagnosticReviews}>Assign selected and add handoff note (242)</button>{" "}
                    <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticOwnerWorkload}>Export owner workload JSON (243)</button>{" "}
                    <button type="button" onClick={() => { setDiagnosticOwnerOnlyOpen(false); setDiagnosticOwnerOnlyHigh(false); setDiagnosticOwnerOnlyUnnoted(false); setDiagnosticOwnerSort("existing"); setDiagnosticPage(1); }}>Reset workload filters</button>
                  </details>
                  <details className="compact-collapsible"><summary>Review focus and workload snapshots (244-253)</summary>
                    <p className="muted">Focus on a small review queue without changing the underlying records. All controls are browser-local.</p>
                    <label>Owner contains (244) <input type="text" maxLength={80} value={reviewFocusOwner} onChange={e => setReviewFocusOwner(e.target.value)} placeholder="Operator name" /></label>
                    <label>Priority (245) <select value={reviewFocusPriority} onChange={e => setReviewFocusPriority(e.target.value as typeof reviewFocusPriority)}><option value="all">All</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
                    <label>Status (246) <select value={reviewFocusStatus} onChange={e => setReviewFocusStatus(e.target.value as typeof reviewFocusStatus)}><option value="all">All</option><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
                    <label><input type="checkbox" checked={reviewFocusOnlyOverdue} onChange={e => setReviewFocusOnlyOverdue(e.target.checked)} /> Overdue open reviews only (247)</label>
                    <label><input type="checkbox" checked={reviewFocusOnlyUnassigned} onChange={e => setReviewFocusOnlyUnassigned(e.target.checked)} /> Unassigned reviews only (248)</label>
                    <label>Queue sort (249) <select value={reviewFocusSort} onChange={e => setReviewFocusSort(e.target.value as typeof reviewFocusSort)}><option value="age">Oldest first</option><option value="priority">High priority, then oldest</option></select></label>
                    <label>Snapshot limit (250) <select value={reviewFocusLimit} onChange={e => setReviewFocusLimit(Number(e.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
                    <p className="muted">Matching reviews (251): {reviewFocusRows.length} total, {reviewFocusOpen} open, {reviewFocusHigh} high priority, {reviewFocusUnassigned} unassigned.</p>
                    <button type="button" disabled={!reviewFocusRows.length} onClick={() => { setDiagnosticSelected(previous => Array.from(new Set([...previous, ...reviewFocusRows.slice(0, reviewFocusLimit).map(diagnosticKey)]))); setDiagnosticBulkNotice(`Selected up to ${reviewFocusLimit} focused reviews.`); }}>Select focused reviews (252)</button>{" "}
                    <label><input type="checkbox" checked={reviewFocusIncludeNotes} onChange={e => setReviewFocusIncludeNotes(e.target.checked)} /> Include operator notes in snapshot</label>
                    <button type="button" disabled={!reviewFocusRows.length} onClick={exportReviewFocusSnapshot}>Export focused JSON (253)</button>{" "}
                    <button type="button" onClick={resetReviewFocus}>Reset focus</button>
                    <details className="compact-collapsible"><summary>Saved review filter presets (254-263)</summary>
                      <p className="muted">Presets save filter settings in this browser only. They never change reviews or backend configuration.</p>
                      <label>Preset name (254) <input type="text" maxLength={60} value={reviewPresetName} onChange={e => setReviewPresetName(e.target.value)} placeholder="e.g. Overdue high priority" /></label>
                      <button type="button" onClick={saveReviewPreset}>Save current filters (255)</button>{" "}
                      <label>Saved presets (256) <select value={reviewPresetSelected} onChange={e => setReviewPresetSelected(e.target.value)}><option value="">Choose preset</option>{reviewPresets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
                      <button type="button" disabled={!reviewPresetSelected} onClick={applyReviewPreset}>Apply selected preset (257)</button>{" "}
                      <button type="button" disabled={!reviewPresetSelected} onClick={renameReviewPreset}>Rename selected (258)</button>{" "}
                      <button type="button" disabled={!reviewPresetSelected} onClick={deleteReviewPreset}>Delete selected (259)</button>
                      <p className="muted">{reviewPresets.length}/20 saved presets (260). Names are unique without regard to case.</p>
                      <button type="button" onClick={exportReviewPresets} disabled={!reviewPresets.length}>Export presets JSON (261)</button>{" "}
                      <label>Import presets JSON (262) <input type="file" accept=".json,application/json" onChange={e => { void importReviewPresets(e.target.files?.[0]); e.target.value = ""; }} /></label>
                      {reviewPresetMessage && <p role="status">{reviewPresetMessage} (263)</p>}
                    </details>
                  </details>
                  <p className="muted">Ownership is stored only in this browser. It is not synchronized across dashboards.</p>
                </details>
                <button type="button" onClick={resetDiagnosticReviewQueue}>Reset review queue filters (222)</button>{" "}
                <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticReviewSnapshot}>Export review snapshot JSON (223)</button>
              </details>
              <label>Bulk status <select value={diagnosticTriageBulkStatus} onChange={e => setDiagnosticTriageBulkStatus(e.target.value as DiagnosticTriage["status"])}><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { status: diagnosticTriageBulkStatus })}>Set selected status</button>{" "}
              <label>Bulk priority <select value={diagnosticTriageBulkPriority} onChange={e => setDiagnosticTriageBulkPriority(e.target.value as DiagnosticTriage["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { priority: diagnosticTriageBulkPriority })}>Set selected priority</button>{" "}
              <button type="button" disabled={!selectedImportDiagnostics.length} onClick={() => { if (window.confirm(`Reset triage labels for ${selectedImportDiagnostics.length} selected records?`)) updateDiagnosticTriage(selectedImportDiagnostics.map(diagnosticKey), { status: "new", priority: "normal" }); }}>Reset selected triage</button>{" "}
              <button type="button" onClick={cleanOrphanedDiagnosticTriage}>Clean orphaned triage</button>{" "}
              <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticTriageRecords}>Export matching triage JSON</button>
            </details>
            <label><input type="checkbox" checked={diagnosticNotesOnly} onChange={e => { setDiagnosticNotesOnly(e.target.checked); setDiagnosticPage(1); }} /> Annotated records only</label>
            <label>Search operator notes <input type="search" value={diagnosticNoteSearch} onChange={e => { setDiagnosticNoteSearch(e.target.value); setDiagnosticPage(1); }} placeholder="Search notes" /></label>
            <label><input type="checkbox" checked={diagnosticIncludeNotesInExports} onChange={e => setDiagnosticIncludeNotesInExports(e.target.checked)} /> Include operator notes in record JSON/Markdown exports</label>
            <p className="muted">Annotated matching records: {diagnosticAnnotatedCount} | Active days: {Object.keys(diagnosticDays).length} | Distinct rejection categories: {Object.keys(diagnosticErrorTypes).length}</p>
            <button type="button" disabled={!diagnosticSelected.some(key => diagnosticNotes[key])} onClick={clearSelectedDiagnosticNotes}>Clear selected notes</button>{" "}
            <button type="button" onClick={pruneOrphanedDiagnosticNotes}>Clean orphaned notes</button>{" "}
            <button type="button" disabled={!diagnosticAnnotatedCount} onClick={exportDiagnosticNotes}>Export notes JSON</button>{" "}
            <button type="button" onClick={exportDiagnosticTriageSummary}>Export triage summary JSON</button>
            <label><input type="checkbox" checked={diagnosticRedactExports} onChange={e => setDiagnosticRedactExports(e.target.checked)} /> Redact filenames in record exports (CSV, JSON, Markdown)</label>
            <p className="muted">Redaction applies to downloaded record files only. The on-screen history and summary grouping remain unchanged.</p>
            {diagnosticBulkNotice && <p role="status" className="muted">{diagnosticBulkNotice}</p>}
            <button type="button" disabled={!visibleImportDiagnostics.length} onClick={invertVisibleDiagnosticSelection}>Invert visible selection</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.some(item => item.outcome === "rejected")} onClick={() => selectDiagnosticSubset("rejected")}>Select matching rejected</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.some(item => diagnosticPinned.includes(diagnosticKey(item)))} onClick={() => selectDiagnosticSubset("pinned")}>Select matching pinned</button>{" "}
            <button type="button" disabled={!diagnosticSelectedPinned} onClick={unpinSelectedDiagnostics}>Unpin selected</button>{" "}
            <button type="button" disabled={!importDiagnostics.some(item => !diagnosticPinned.includes(diagnosticKey(item)))} onClick={removeUnpinnedDiagnostics}>Delete all unpinned</button>{" "}
            <button type="button" disabled={!diagnosticPinned.length} onClick={pruneOrphanedDiagnosticPins}>Clean orphaned pins</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={exportSelectedDiagnosticsCsv}>Export selected CSV</button>{" "}
            <button type="button" disabled={!importDiagnostics.some(item => diagnosticPinned.includes(diagnosticKey(item)))} onClick={exportPinnedDiagnostics}>Export pinned JSON</button>

            <button type="button" disabled={!visibleImportDiagnostics.length} onClick={() => setDiagnosticSelected(previous => Array.from(new Set([...previous, ...visibleImportDiagnostics.map(diagnosticKey)])))}>Select visible page</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={() => setDiagnosticSelected(filteredImportDiagnostics.map(diagnosticKey))}>Select all matching</button>{" "}
            <button type="button" disabled={!diagnosticSelected.length} onClick={() => setDiagnosticSelected([])}>Clear selection</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={exportSelectedDiagnostics}>Export selected JSON</button>{" "}
            <button type="button" disabled={!selectedImportDiagnostics.length} onClick={deleteSelectedDiagnostics}>Delete selected local records</button>
            <label>Result <select value={diagnosticFilter} onChange={e => setDiagnosticFilter(e.target.value)}><option value="all">All</option><option value="verified">Verified</option><option value="legacy">Legacy unverified</option><option value="rejected">Rejected</option></select></label>
            <label>Search diagnostics <input type="search" value={diagnosticSearch} onChange={e => { setDiagnosticSearch(e.target.value); setDiagnosticPage(1); }} placeholder="Filename, validation check or error" /></label>
            <label>Filename contains <input type="search" value={diagnosticFileFilter} onChange={e => { setDiagnosticFileFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Filter by filename" /></label>
            <label>Validation checkpoint contains <input type="search" value={diagnosticCheckFilter} onChange={e => { setDiagnosticCheckFilter(e.target.value); setDiagnosticPage(1); }} placeholder="Filter by passed check" /></label>
            <label>From <input type="date" value={diagnosticFrom} onChange={e => setDiagnosticFrom(e.target.value)} /></label>
            <label>To <input type="date" value={diagnosticTo} onChange={e => setDiagnosticTo(e.target.value)} /></label>
            <label>Minimum file size (bytes) <input type="number" min="0" step="1" value={diagnosticMinBytes} onChange={e => { setDiagnosticMinBytes(e.target.value); setDiagnosticPage(1); }} /></label>
            <label>Maximum file size (bytes) <input type="number" min="0" step="1" value={diagnosticMaxBytes} onChange={e => { setDiagnosticMaxBytes(e.target.value); setDiagnosticPage(1); }} /></label>
            <label><input type="checkbox" checked={diagnosticErrorsOnly} onChange={e => { setDiagnosticErrorsOnly(e.target.checked); setDiagnosticPage(1); }} /> Errors only</label>
            <label>Order <select value={diagnosticSort} onChange={e => setDiagnosticSort(e.target.value as "newest" | "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            <p className="muted">Matching {filteredImportDiagnostics.length} of {importDiagnostics.length} retained attempts | Verified: {diagnosticCounts.verified} | Legacy: {diagnosticCounts.legacy} | Rejected: {diagnosticCounts.rejected}</p>
            <p className="muted">Import acceptance rate: {diagnosticSuccessPercent === null ? "No matching attempts" : `${diagnosticSuccessPercent}%`} (verified or legacy accepted). This is a backup-import metric, not camera reliability.</p>
            <p className="muted">Unique filenames: {diagnosticUniqueFiles} | Average file size: {diagnosticAverageBytes === null ? "N/A" : `${diagnosticAverageBytes} bytes`} | Passed checkpoints: {diagnosticTotalChecks}</p>
            <p className="muted">Most recent retained attempt: {diagnosticLatestAttempt ? `${new Date(diagnosticLatestAttempt.at).toLocaleString()} (${diagnosticLatestAttempt.outcome})` : "None"}</p>
            <label><input type="checkbox" checked={diagnosticShowChecks} onChange={e => setDiagnosticShowChecks(e.target.checked)} /> Show validation checkpoints</label>
            <label><input type="checkbox" checked={diagnosticShowErrors} onChange={e => setDiagnosticShowErrors(e.target.checked)} /> Show error details</label>
            <label>Records per page <select value={diagnosticPageSize} onChange={e => { setDiagnosticPageSize(Number(e.target.value)); setDiagnosticPage(1); }}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
            <span className="muted"> Showing {diagnosticVisibleStart}-{diagnosticVisibleEnd} of {filteredImportDiagnostics.length} | Page {safeDiagnosticPage} of {diagnosticPageCount} </span>
            <button type="button" disabled={safeDiagnosticPage <= 1} onClick={() => setDiagnosticPage(1)}>First page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage <= 1} onClick={() => setDiagnosticPage(p => Math.max(1, p - 1))}>Previous page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage >= diagnosticPageCount} onClick={() => setDiagnosticPage(p => Math.min(diagnosticPageCount, p + 1))}>Next page</button>{" "}
            <button type="button" disabled={safeDiagnosticPage >= diagnosticPageCount} onClick={() => setDiagnosticPage(diagnosticPageCount)}>Last page</button>
            <label>Go to page <input type="number" min="1" max={diagnosticPageCount} value={diagnosticJumpPage} onChange={e => setDiagnosticJumpPage(e.target.value)} style={{ width: 70 }} /></label>
            <button type="button" onClick={() => { const page = Number(diagnosticJumpPage); if (Number.isInteger(page) && page >= 1 && page <= diagnosticPageCount) setDiagnosticPage(page); }}>Go</button>{" "}
            <button type="button" onClick={() => { setDiagnosticFilter("all"); setDiagnosticSearch(""); setDiagnosticFrom(""); setDiagnosticTo(""); setDiagnosticSort("newest"); setDiagnosticMinBytes(""); setDiagnosticMaxBytes(""); setDiagnosticErrorsOnly(false); setDiagnosticFileFilter(""); setDiagnosticCheckFilter(""); setDiagnosticShowChecks(true); setDiagnosticShowErrors(true); setDiagnosticPinnedOnly(false); setDiagnosticNotesOnly(false); setDiagnosticNoteSearch(""); setDiagnosticGroupBy("none"); setDiagnosticTriageStatusFilter("all"); setDiagnosticTriagePriorityFilter("all"); setDiagnosticTriageOnlyOpen(false); setDiagnosticTriageOnlyHigh(false); setDiagnosticPage(1); setDiagnosticJumpPage("1"); }}>Reset filters</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportImportDiagnostics}>Export diagnostics CSV</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportImportDiagnosticsJson}>Export diagnostics JSON</button>{" "}
            <button type="button" onClick={exportDiagnosticSummary}>Export summary JSON</button>{" "}
            <button type="button" disabled={!filteredImportDiagnostics.length} onClick={exportDiagnosticMarkdown}>Export report Markdown</button>{" "}
            <button type="button" disabled={!importDiagnostics.length} onClick={() => { if (window.confirm("Clear this browser's threshold import diagnostic history?")) { setImportDiagnostics([]); setDiagnosticSelected([]); setDiagnosticPinned([]); localStorage.removeItem("tournament-threshold-import-diagnostics-v1"); localStorage.removeItem("tournament-threshold-import-pins-v1"); setDiagnosticNotes({}); localStorage.removeItem("tournament-threshold-import-notes-v1"); setDiagnosticTriage({}); localStorage.removeItem("tournament-threshold-import-triage-v1"); setDiagnosticReviewOwners({}); localStorage.removeItem("tournament-threshold-import-owners-v1"); } }}>Clear local history</button>
            {diagnosticCopyNotice && <p role="status" className="muted">{diagnosticCopyNotice}</p>}
            {visibleImportDiagnostics.map((item, index) => <details key={`${item.at}-${index}`} className="compact-collapsible"><summary>{new Date(item.at).toLocaleString()} | {item.outcome} | {item.fileName}</summary>
              <p>File size: {item.bytes} bytes</p>
              <label>Triage status <select value={triageFor(diagnosticKey(item)).status} onChange={e => updateDiagnosticTriage([diagnosticKey(item)], { status: e.target.value as DiagnosticTriage["status"] })}><option value="new">New</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select></label>
              <label>Priority <select value={triageFor(diagnosticKey(item)).priority} onChange={e => updateDiagnosticTriage([diagnosticKey(item)], { priority: e.target.value as DiagnosticTriage["priority"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              <label>Operator note (browser-local, 500 characters max) <textarea rows={2} maxLength={500} value={diagnosticNotes[diagnosticKey(item)] || ""} onChange={e => saveDiagnosticNote(diagnosticKey(item), e.target.value)} placeholder="Add investigation details" /></label>
              <button type="button" disabled={!diagnosticNotes[diagnosticKey(item)]} onClick={() => saveDiagnosticNote(diagnosticKey(item), "")}>Clear note</button>
              {diagnosticShowChecks && item.checks.map((check, i) => <p key={i}>Passed: {check}</p>)}
              {diagnosticShowErrors && item.error && <p role="alert">Rejected: {item.error}</p>}
              <label><input type="checkbox" checked={diagnosticSelected.includes(diagnosticKey(item))} onChange={e => setDiagnosticSelected(previous => e.target.checked ? Array.from(new Set([...previous, diagnosticKey(item)])) : previous.filter(key => key !== diagnosticKey(item)))} /> Select record</label>{" "}
              <button type="button" onClick={() => toggleDiagnosticPin(diagnosticKey(item))}>{diagnosticPinned.includes(diagnosticKey(item)) ? "Unpin record" : "Pin record"}</button>{" "}
              <button type="button" onClick={() => void copySingleDiagnostic(item)}>Copy details</button>{" "}
              <button type="button" onClick={() => exportSingleDiagnostic(item)}>Export this record JSON</button>
            </details>)}
          </details>
          {importedRules && <div className="bulk-results"><p><strong>Validated backup:</strong> {importFileName}</p>
            {importIntegrityStatus && <p className="muted">{importIntegrityStatus}</p>}
            <p className="muted">Compare the imported values against the current editor. Select only the fields to restore. Unselected values remain unchanged.</p>
            <button type="button" onClick={() => setSelectedImportFields(Object.keys(importedRules) as Array<keyof ReliabilityRules>)}>Select all</button>{" "}
            <button type="button" onClick={() => setSelectedImportFields([])}>Select none</button>
            {(Object.keys(importedRules) as Array<keyof ReliabilityRules>).map(key => <label key={key} style={{ display: "block" }}>
              <input type="checkbox" checked={selectedImportFields.includes(key)} onChange={e => setSelectedImportFields(previous => e.target.checked ? [...previous, key] : previous.filter(field => field !== key))} />{" "}
              <strong>{key}</strong>: current {reliabilityRules[key]} → backup {importedRules[key]} {reliabilityRules[key] === importedRules[key] ? "(unchanged)" : "(different)"}
            </label>)}
            {importMergeError && <p role="alert">Selected fields produce invalid thresholds: {importMergeError}. Adjust your selection before applying.</p>}
            {mergedImportRules && !importMergeError && <p className="muted">Merged preview: {Object.entries(mergedImportRules).map(([key, value]) => `${key}=${value}`).join(", ")}</p>}
            <button type="button" disabled={!selectedImportFields.length || !!importMergeError || rulesSaving || rulesConflict || !rulesReady} onClick={applyReliabilityImport}>Apply selected values to editor</button>
            <button type="button" onClick={() => { setImportedRules(null); setImportFileName(""); setSelectedImportFields([]); }}>Cancel import</button>
          </div>}
        </details>
        <details className="compact-collapsible"><summary>Shared threshold change history ({ruleHistory.length})</summary>
          <p className="muted">Last 500 recorded changes, newest first. Timestamps use your local timezone. Changes are shared across connected dashboards.</p>
          {ruleHistory.length === 0 ? <p>No threshold changes recorded.</p> : ruleHistory.slice(0, 50).map(change => <div key={change.id} className="bulk-results">
            <p><strong>{new Date(change.at).toLocaleString()}</strong> {change.note ? `| ${change.note}` : "| No reason supplied"}</p>
            <button type="button" disabled={rulesSaving || rulesConflict || rulesVersion === null} onClick={() => void restoreHistoricalRules(change.id, "before")}>Restore previous values</button>
            <button type="button" disabled={rulesSaving || rulesConflict || rulesVersion === null} onClick={() => void restoreHistoricalRules(change.id, "after")}>Restore updated values</button>
            {(Object.keys(change.after) as Array<keyof ReliabilityRules>).filter(key => change.before[key] !== change.after[key]).map(key => <p key={key}>{key}: {change.before[key]} → {change.after[key]}</p>)}
          </div>)}
        </details>
        {reliabilityWarnings.length === 0 ? <p>No cameras currently cross the configured reliability thresholds.</p> :
          <div className="bulk-results">{reliabilityWarnings.map(warning => <p key={warning.cameraId} role="status">
            <strong>{warning.severity}: {warning.cameraId}</strong> | {warning.failures} failures / {warning.attempts} attempts | {warning.rate}% successful
          </p>)}</div>}
      </details>
      <details className="compact-collapsible"><summary>Reliability warning history ({reliabilityHistory.length})</summary>
        <p className="muted">Shared server history of changes between Normal, Warning, and Critical. A new audit attempt or a threshold/reporting-period change can produce a transition. No changes are recorded on an unchanged polling refresh. Transitions and acknowledgements synchronize through the node service.</p>
        <label>Transition to <select value={historyFilter} onChange={e => setHistoryFilter(e.target.value)}>
          <option value="all">All states</option><option value="Warning">Warning</option><option value="Critical">Critical</option><option value="Normal">Normal</option>
        </select></label>
        <label>Operator review <select value={historyReviewFilter} onChange={e => setHistoryReviewFilter(e.target.value)}>
          <option value="all">All</option><option value="unreviewed">Unacknowledged</option><option value="reviewed">Acknowledged</option>
        </select></label>
        <button type="button" disabled={!visibleReliabilityHistory.length} onClick={exportReliabilityHistory}>Export warning history CSV</button>
        {visibleReliabilityHistory.length === 0 ? <p>No recorded warning transitions.</p> :
          <div className="bulk-results">{visibleReliabilityHistory.slice(0, 50).map((item, index) => <p key={`${item.at}-${item.cameraId}-${index}`}>
            <strong>{item.cameraId}: {item.from} → {item.to}</strong> | {new Date(item.at).toLocaleString()} | {item.reason}
            {reliabilityReviews[reliabilityReviewKey(item)] ?
              <span> | Acknowledged {new Date(reliabilityReviews[reliabilityReviewKey(item)].acknowledgedAt).toLocaleString()} | Note: {reliabilityReviews[reliabilityReviewKey(item)].note}</span> :
              <span> | Unacknowledged <label>Operator note <input type="text" maxLength={1000} value={reviewNotes[reliabilityReviewKey(item)] || ""} onChange={e => setReviewNotes(previous => ({ ...previous, [reliabilityReviewKey(item)]: e.target.value }))} /></label>
                <button type="button" disabled={!((reviewNotes[reliabilityReviewKey(item)] || "").trim())} onClick={() => acknowledgeReliabilityWarning(item)}>Acknowledge</button></span>}
          </p>)}</div>}
        {visibleReliabilityHistory.length > 50 && <p className="muted">Showing 50 of {visibleReliabilityHistory.length} matching transitions. CSV includes all matches.</p>}
      </details>
      <details className="compact-collapsible"><summary>Camera reliability breakdown ({recoveryStatistics.cameras.length})</summary>
        {recoveryStatistics.cameras.length === 0 ? <p>No recovery attempts in this period.</p> :
          <div className="bulk-results">{recoveryStatistics.cameras.map(camera => <p key={camera.cameraId}>
            <strong>{camera.cameraId}</strong>: {camera.successes} successful, {camera.failures} failed ({Math.round(camera.successes * 100 / (camera.successes + camera.failures))}% success)
          </p>)}</div>}
      </details>
      <details className="compact-collapsible"><summary>Daily recovery trend ({recoveryStatistics.daily.length} days with attempts)</summary>
        {recoveryStatistics.daily.length === 0 ? <p>No recovery attempts in this period.</p> :
          <div className="bulk-results">{recoveryStatistics.daily.map(day => <p key={day.day}>
            <strong>{day.day}</strong>: {day.successes} successful, {day.failures} failed
          </p>)}</div>}
      </details>
    </details>
    <details className="compact-collapsible"><summary>Incident timeline and operator audit ({audit.length})</summary>
      <p className="muted">Search and filter the latest 2,000 retained audit events. Export downloads the filtered records as CSV. Filters do not alter the stored audit.</p>
      <div className="bulk-results">
        <label>Search camera, event or details <input type="search" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} placeholder="Search audit" /></label>
        <label>Event type <select value={auditType} onChange={e => setAuditType(e.target.value)}>
          <option value="all">All types</option><option value="failure">Failure</option><option value="success">Success</option>
          <option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="reopened">Reopened</option>
        </select></label>
        <label>From <input type="date" value={auditFrom} onChange={e => setAuditFrom(e.target.value)} /></label>
        <label>Through <input type="date" value={auditTo} onChange={e => setAuditTo(e.target.value)} /></label>
        <p>{filteredAudit.length} matching events of {audit.length} retained.</p>
        <button type="button" onClick={() => { setAuditSearch(""); setAuditType("all"); setAuditFrom(""); setAuditTo(""); }}>Clear filters</button>
        <button type="button" disabled={filteredAudit.length === 0} onClick={exportAuditCsv}>Export filtered CSV ({filteredAudit.length})</button>
      </div>
      {filteredAudit.length === 0 ? <p>No matching audit events.</p> :
        <div className="bulk-results">{filteredAudit.slice(0, 100).map((entry, index) => <p key={`${entry.at}-${entry.cameraId}-${entry.type}-${index}`}>
          <strong>{entry.type}</strong> | {new Date(entry.at).toLocaleString()} | {entry.cameraId}: {entry.detail}
        </p>)}</div>}
      {filteredAudit.length > 100 && <p className="muted">Showing first 100 matching events. CSV export includes all {filteredAudit.length} matches.</p>}
    </details>
    <details className="compact-collapsible"><summary>Recovery history ({events.length})</summary>
      {events.length === 0 ? <p>No recovery attempts recorded.</p> :
        <div className="bulk-results">{events.map((event, i) => <p key={`${event.at}-${event.cameraId}-${i}`}>
          <strong>{event.outcome === "success" ? "Recovered" : "Failed"}</strong> | {new Date(event.at).toLocaleString()} | {event.cameraId}: {event.detail} {event.acknowledgedAt ? "| Acknowledged" : event.outcome === "failure" ? "| Needs review" : ""}
        </p>)}</div>}
    </details>
  </section>;
}

function CaptureSignalHealthPanel({ requestNode, nodeId }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>; nodeId: string;
}) {
  const [rules, setRules] = useState<SignalAlertRules>(() => loadSignalRules(nodeId));
  const rulesRef = useRef(rules);
  const [cameraOverrides, setCameraOverrides] = useState<Record<string, CameraSignalOverride>>(() => loadCameraSignalOverrides(nodeId));
  const overridesRef = useRef(cameraOverrides);
  const [monitoringPaused, setMonitoringPaused] = useState(false);
  // A manual retry starts a new polling cycle without touching capture or stream processes.
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [lastAttemptAt, setLastAttemptAt] = useState<number | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [pollInFlight, setPollInFlight] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [reconnectionCount, setReconnectionCount] = useState(0);
  const failureStreakRef = useRef(0);
  const lastSuccessfulAtRef = useRef<number | null>(null);
  const [displayClock, setDisplayClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setDisplayClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pausedRef = useRef(false);
  useEffect(() => { overridesRef.current = cameraOverrides; try { localStorage.setItem(`tournament-camera-signal-rules:v1:${nodeId}`, JSON.stringify(cameraOverrides)); } catch { /* storage unavailable */ } }, [cameraOverrides, nodeId]);
  useEffect(() => { pausedRef.current = monitoringPaused; }, [monitoringPaused]);
  const streaks = useRef(new Map<string, number>());
  const lastEventAt = useRef(new Map<string, number>());
  const emittedWarning = useRef(new Set<string>());
  useEffect(() => { rulesRef.current = rules; try { localStorage.setItem(`tournament-signal-rules:v1:${nodeId}`, JSON.stringify(rules)); } catch { /* private browsing */ } }, [rules, nodeId]);
  useEffect(() => { setRules(loadSignalRules(nodeId)); setCameraOverrides(loadCameraSignalOverrides(nodeId)); setMonitoringPaused(false); failureStreakRef.current = 0; lastSuccessfulAtRef.current = null; setNextRetryAt(null); setConsecutiveFailures(0); setReconnectionCount(0); previous.current = null; previousError.current = false; streaks.current.clear(); lastEventAt.current.clear(); emittedWarning.current.clear(); }, [nodeId]);
  const [snapshot, setSnapshot] = useState<CaptureSignalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const storageKey = `tournament-signal-alerts:v1:${nodeId}`;
  const [alerts, setAlerts] = useState<SignalAlert[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((a): a is SignalAlert =>
        a !== null && typeof a === "object" && typeof a.id === "number" &&
        typeof a.at === "number" && typeof a.cameraName === "string" &&
        typeof a.message === "string" && (a.level === "warning" || a.level === "recovered")
      ).slice(0, 500) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(alerts)); } catch { /* storage unavailable */ }
  }, [alerts, storageKey]);
  function exportAlerts(format: "json" | "csv") {
    const fields = ["at", "cameraName", "kind", "level", "severity", "message", "acknowledged"] as const;
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const body = format === "json" ? JSON.stringify({ exportedAt: new Date().toISOString(), nodeId, alerts }, null, 2)
      : [fields.join(","), ...alerts.map(alert => fields.map(field =>
        escapeCsv(field === "at" ? new Date(alert.at).toISOString() : alert[field])).join(","))].join("\r\n");
    const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `signal-alerts-${nodeId.replace(/[^a-z0-9_-]/gi, "_")}.${format}`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const [showHistory, setShowHistory] = useState(false);
  const [historyLevel, setHistoryLevel] = useState<"all" | "warning" | "recovered">("all");
  const [historyKind, setHistoryKind] = useState<"all" | SignalAlertKind>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [onlyUnacknowledged, setOnlyUnacknowledged] = useState(false);
  const [historySeverity, setHistorySeverity] = useState<"all" | "warning" | "critical">("all");
  const previous = useRef<Map<string, { video: string; audio: string }> | null>(null);
  const previousError = useRef(false);
  const sequence = useRef(Math.max(0, ...alerts.map(alert => alert.id)));
  useEffect(() => {
    let mounted = true;
    let pending = false;
    let retryDueAt = 0;
    const addAlerts = (events: Omit<SignalAlert, "id">[]) => {
      if (!events.length || !mounted) return;
      setAlerts(old => [...events.map(event => ({ ...event, id: ++sequence.current })), ...old].slice(0, 500));
    };
    const refresh = async () => {
      if (pending || pausedRef.current || (retryDueAt > Date.now())) return;
      pending = true;
      setPollInFlight(true);
      setLastAttemptAt(Date.now());
      try {
        const result = await requestNode("/api/captures/signal-diagnostics") as CaptureSignalSnapshot;
        if (!mounted) return;
        if (!result || !Array.isArray(result.captures)) throw new Error("Invalid signal diagnostics response");
        const now = Date.now();
        const current = new Map<string, { video: string; audio: string }>();
        const events: Omit<SignalAlert, "id">[] = [];
        for (const item of result.captures) {
          const activeRules = cameraRules(rulesRef.current, overridesRef.current[item.cameraId]);
          const { video, audio } = classifiedSignal(item, activeRules);
          current.set(item.cameraId, { video, audio });
          const prior = previous.current?.get(item.cameraId);
          if (!prior) continue; // Initial readings and newly started captures establish a baseline.
          const checks = activeRules.consecutiveChecks;
          const observe = (kind: "video" | "audio", currentState: string, priorState: string, warning: (state: string) => boolean) => {
            const key = `${item.cameraId}:${kind}`;
            if (currentState === priorState) {
              // Accumulate persistent warnings even when state is unchanged.
              if (warning(currentState)) streaks.current.set(key, Math.min(checks, (streaks.current.get(key) || 0) + 1));
              else streaks.current.delete(key);
            } else if (warning(currentState)) streaks.current.set(key, 1);
            else streaks.current.delete(key);
            if (!activeRules.enabled) { emittedWarning.current.delete(key); streaks.current.delete(key); return; }
            if (!warning(currentState)) emittedWarning.current.delete(key);
            const warningNow = warning(currentState);
            const warningBefore = warning(priorState);
            const eventKey = `${key}:${warningNow ? currentState : "recovered"}`;
            const elapsed = now - (lastEventAt.current.get(eventKey) || 0);
            if (warningNow && !emittedWarning.current.has(key) && (streaks.current.get(key) || 0) >= checks && elapsed >= activeRules.cooldownSeconds * 1000) {
              events.push({ at: now, cameraName: item.cameraName, kind, level: "warning", severity: signalSeverity(kind, currentState), message: `${kind === "video" ? "Video" : "Audio"}: ${currentState}` });
              lastEventAt.current.set(eventKey, now);
              emittedWarning.current.add(key);
              streaks.current.set(key, 0);
            } else if (!warningNow && warningBefore && elapsed >= activeRules.cooldownSeconds * 1000) {
              events.push({ at: now, cameraName: item.cameraName, kind, level: "recovered", message: `${kind === "video" ? "Video" : "Audio"} signal restored` });
              lastEventAt.current.set(eventKey, now);
            }
          };
          observe("video", video, prior.video, isVideoWarning);
          observe("audio", audio, prior.audio, state => isAudioWarning(state) || (activeRules.alertOnSilence && state === "audio-silent"));
        }
        if (previousError.current) {
          setReconnectionCount(count => count + 1);
          const gapSeconds = lastSuccessfulAtRef.current === null ? "unknown" : String(Math.round((now - lastSuccessfulAtRef.current) / 1000));
          if (rulesRef.current.enabled) events.push({ at: now, cameraName: "Local node", kind: "connection", level: "recovered", message: `Signal diagnostics connection restored after ${gapSeconds}s; ${failureStreakRef.current} failed check(s)` });
        }
        failureStreakRef.current = 0;
        lastSuccessfulAtRef.current = now;
        retryDueAt = 0;
        setNextRetryAt(null);
        previous.current = current;
        previousError.current = false;
        addAlerts(events);
        setSnapshot(result);
        setUpdatedAt(now);
        setError(null);
        setConsecutiveFailures(0);
      } catch (cause) {
        if (mounted) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (rulesRef.current.enabled && !previousError.current) addAlerts([{ at: Date.now(), cameraName: "Local node", kind: "connection", level: "warning", severity: "critical", message: `Signal diagnostics unavailable: ${message}` }]);
          previousError.current = true;
          // Avoid false per-camera recovery alerts after a gap in monitoring.
          previous.current = null;
          setError(message);
          failureStreakRef.current += 1;
          setConsecutiveFailures(failureStreakRef.current);
          // Exponential backoff prevents a disconnected remote node from being hammered.
          // 3s, 6s, 12s, 24s, capped at 30s; no overlapping requests.
          const delay = Math.min(30000, 3000 * 2 ** Math.min(4, failureStreakRef.current - 1));
          retryDueAt = Date.now() + delay;
          setNextRetryAt(retryDueAt);
        }
      } finally { pending = false; if (mounted) setPollInFlight(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [requestNode, retryGeneration]);

  const formatAge = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : "n/a";
  const videoLabel = (status: string, freeze: number | null | undefined) =>
    typeof freeze === "number" && freeze > 0 ? "Possible freeze" :
    status === "receiving" ? "Receiving" : status;
  const audioLabel = (status: string) => ({
    "audio-active": "Active", "audio-silent": "Silent", "no-audio-samples": "No samples",
    "audio-samples-stalled": "Samples stalled", "unverified-no-silence-event": "Unverified"
  } as Record<string, string>)[status] || status;
  const tone = (status: string) =>
    status === "receiving" || status === "audio-active" ? "#1b8155" :
    status === "audio-silent" || status === "waiting" || status.startsWith("unverified") ? "#a06a16" : "#b63d3d";
  const warningCount = alerts.filter(alert => alert.level === "warning" && !alert.acknowledged).length;
  const filteredAlerts = alerts.filter(alert =>
    (historyLevel === "all" || alert.level === historyLevel) &&
    (historySeverity === "all" || (alert.severity ?? "warning") === historySeverity) &&
    (historyKind === "all" || alert.kind === historyKind) &&
    (!onlyUnacknowledged || !alert.acknowledged) &&
    (!historySearch.trim() || `${alert.cameraName} ${alert.kind} ${alert.message}`.toLowerCase().includes(historySearch.trim().toLowerCase()))
  );
  const acknowledge = (id: number) => setAlerts(old => old.map(alert =>
    alert.id === id ? { ...alert, acknowledged: !alert.acknowledged } : alert));
  return <section className="overview" aria-label="Capture signal health">
    <h2>Capture Signal Health</h2>
    <p className="muted">Local video and microphone diagnostics, refreshed every 3 seconds.</p>
    <div role="status" aria-live="polite" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <strong>{monitoringPaused ? "Paused" : error ? "Connection error" : updatedAt === null ? "Waiting for first reading" : displayClock - updatedAt > 10000 ? "Diagnostics stale" : "Monitoring"}</strong>
      <span className="muted">{updatedAt === null ? "No successful reading yet" : `Last successful reading ${Math.max(0, Math.floor((displayClock - updatedAt) / 1000))}s ago`}</span>
      {lastAttemptAt !== null && <span className="muted">Last attempt: {new Date(lastAttemptAt).toLocaleTimeString()}</span>}
      {consecutiveFailures > 0 && <span role="alert">Failed checks: {consecutiveFailures}</span>}
      {nextRetryAt !== null && !monitoringPaused && <span className="muted">Automatic retry in {Math.max(0, Math.ceil((nextRetryAt - displayClock) / 1000))}s</span>}
      {reconnectionCount > 0 && <span className="muted">Recovered connections: {reconnectionCount}</span>}
      {pollInFlight && <span className="muted">Checking...</span>}
      <button type="button" disabled={pollInFlight || monitoringPaused} onClick={() => {
        previous.current = null;
        streaks.current.clear();
        setNextRetryAt(null);
        setRetryGeneration(value => value + 1);
      }}>Check now</button>
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
      <button type="button" onClick={() => { setMonitoringPaused(v => !v); previous.current = null; streaks.current.clear(); }}>{monitoringPaused ? "Resume monitoring" : "Pause monitoring"}</button>
      {monitoringPaused && <span role="status" className="muted">Monitoring paused. Last readings remain visible; no new alerts are generated.</span>}
    </div>
    {error && <p role="alert">Signal diagnostics unavailable: {error}{updatedAt !== null ? " (showing last successful reading)" : ""}</p>}
    {!snapshot && !error && <p className="muted">Loading signal diagnostics...</p>}
    {snapshot && snapshot.captures.length === 0 && <p className="muted">No active local camera captures.</p>}
    {snapshot && snapshot.captures.length > 0 && <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
        <thead><tr><th style={{ textAlign: "left" }}>Camera</th><th style={{ textAlign: "left" }}>Video</th>
          <th style={{ textAlign: "left" }}>Frame age</th><th style={{ textAlign: "left" }}>Audio</th>
          <th style={{ textAlign: "left" }}>RMS</th><th style={{ textAlign: "left" }}>Sample age</th></tr></thead>
        <tbody>{snapshot.captures.map(item => {
          const freeze = item.video.possibleFreezeMs;
          const videoStatus = videoSignalState(item);
          return <tr key={item.cameraId} style={{ borderTop: "1px solid var(--border-color, #8884)" }}>
            <td style={{ padding: "6px 10px 6px 0" }}>{item.cameraName}</td>
            <td style={{ color: tone(videoStatus), fontWeight: 600 }}>{videoLabel(item.video.status, freeze)}
              {typeof freeze === "number" && freeze > 0 ? ` (${formatAge(freeze)})` : ""}</td>
            <td>{formatAge(item.video.frameAgeMs)}</td>
            <td style={{ color: tone(item.audio.status), fontWeight: 600 }}>{audioLabel(item.audio.status)}</td>
            <td>{typeof item.audio.rmsDb === "number" && Number.isFinite(item.audio.rmsDb)
              ? `${item.audio.rmsDb.toFixed(1)} dBFS` : "n/a"}</td>
            <td>{formatAge(item.audio.audioSampleAgeMs)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {snapshot && <small className="muted">Checked {new Date(snapshot.checkedAt).toLocaleTimeString()}.
      Static scenes can cause freeze warnings. Local audio activity does not verify YouTube playback.</small>}
    <details className="tool-item compact-collapsible" style={{ marginTop: 10 }}>
      <summary>Alert rules and thresholds</summary>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: 8 }}>
        <label><input type="checkbox" checked={rules.enabled} onChange={e => setRules(r => ({ ...r, enabled: e.target.checked }))} /> Enable alert events</label>
        <label><input type="checkbox" checked={rules.alertOnSilence} onChange={e => setRules(r => ({ ...r, alertOnSilence: e.target.checked }))} /> Warn on quiet microphones</label>
        {([ ["freezeWarningSeconds", "Freeze threshold (s)"], ["staleFrameSeconds", "Stale frame (s)"], ["missingAudioSeconds", "Missing audio (s)"], ["consecutiveChecks", "Consecutive checks"], ["cooldownSeconds", "Alert cooldown (s)"] ] as const).map(([key, label]) =>
          <label key={key}>{label} <input type="number" min={1} max={key === "consecutiveChecks" ? 20 : 3600} style={{ width: 70 }} value={rules[key]}
            onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) setRules(r => ({ ...r, [key]: Math.min(key === "consecutiveChecks" ? 20 : 3600, Math.floor(n)) })); }} /></label>
        )}
        <button type="button" onClick={() => setRules({ ...DEFAULT_SIGNAL_RULES })}>Reset defaults</button>
      </div>
      <small className="muted">Rules are stored in this browser for the selected node. They affect dashboard alerts, not camera capture or FFmpeg detection. A quiet microphone can be normal.</small>
    </details>
    <details className="tool-item compact-collapsible" style={{ marginTop: 10 }}>
      <summary>Camera-specific alert rules</summary>
      <div style={{ display: "grid", gap: 10, padding: 8 }}>
        {snapshot?.captures.length ? snapshot.captures.map(item => {
          const override = cameraOverrides[item.cameraId] ?? DEFAULT_CAMERA_OVERRIDE;
          const update = (patch: Partial<CameraSignalOverride>) => setCameraOverrides(old => ({ ...old, [item.cameraId]: { ...(old[item.cameraId] ?? DEFAULT_CAMERA_OVERRIDE), ...patch } }));
          return <div key={item.cameraId} style={{ borderBottom: "1px solid var(--border-color, #8884)", paddingBottom: 8 }}>
            <strong>{item.cameraName}</strong>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
              <label><input type="checkbox" checked={override.enabled} onChange={e => update({ enabled: e.target.checked })} /> Monitor camera</label>
              {([ ["freezeWarningSeconds", "Freeze (s)"], ["staleFrameSeconds", "Stale frame (s)"], ["missingAudioSeconds", "Missing audio (s)"] ] as const).map(([key, label]) =>
                <label key={key}>{label} <input type="number" min={1} max={3600} placeholder="Global" style={{ width: 76 }} value={override[key] ?? ""}
                  onChange={e => update({ [key]: e.target.value === "" ? null : Math.max(1, Math.min(3600, Math.floor(Number(e.target.value) || 1))) })} /></label>
              )}
              <label>Quiet audio <select value={override.alertOnSilence === null ? "global" : override.alertOnSilence ? "on" : "off"}
                onChange={e => update({ alertOnSilence: e.target.value === "global" ? null : e.target.value === "on" })}>
                <option value="global">Global default</option><option value="on">Warn</option><option value="off">Ignore</option>
              </select></label>
              <button type="button" onClick={() => setCameraOverrides(old => { const next = { ...old }; delete next[item.cameraId]; return next; })}>Reset camera</button>
            </div>
          </div>;
        }) : <span className="muted">Start a camera capture to configure its alert rules.</span>}
      </div>
      <small className="muted">Empty thresholds inherit the global values. Camera overrides are stored per node in this browser.</small>
    </details>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      <button type="button" onClick={() => setShowHistory(value => !value)}
        aria-expanded={showHistory} aria-controls="signal-alert-history">
        {showHistory ? "Hide" : "Show"} Signal Alerts ({warningCount} warnings, {alerts.length} events)
      </button>
      {alerts.length > 0 && <button type="button" onClick={() => exportAlerts("json")}>Export JSON</button>}
      {alerts.length > 0 && <button type="button" onClick={() => exportAlerts("csv")}>Export CSV</button>}
      {alerts.length > 0 && <button type="button" onClick={() => { if (window.confirm("Clear saved signal alert history for this node?")) setAlerts([]); }}>Clear History</button>}
      <small className="muted">Saved in this browser, latest 500 events.</small>
    </div>
    {showHistory && <div id="signal-alert-history" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <label>Level <select value={historyLevel} onChange={event => setHistoryLevel(event.target.value as typeof historyLevel)}>
          <option value="all">All</option><option value="warning">Warnings</option><option value="recovered">Recoveries</option>
        </select></label>
        <label>Severity <select value={historySeverity} onChange={event => setHistorySeverity(event.target.value as typeof historySeverity)}>
          <option value="all">All</option><option value="warning">Warning</option><option value="critical">Critical</option>
        </select></label>
        <label>Signal <select value={historyKind} onChange={event => setHistoryKind(event.target.value as typeof historyKind)}>
          <option value="all">All</option><option value="video">Video</option><option value="audio">Audio</option><option value="connection">Connection</option>
        </select></label>
        <label>Search <input type="search" value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Camera or event" /></label>
        <label><input type="checkbox" checked={onlyUnacknowledged} onChange={event => setOnlyUnacknowledged(event.target.checked)} /> Unacknowledged only</label>
        <button type="button" disabled={!alerts.some(alert => alert.level === "warning" && !alert.acknowledged)}
          onClick={() => setAlerts(old => old.map(alert => alert.level === "warning" ? { ...alert, acknowledged: true } : alert))}>
          Acknowledge all warnings
        </button>
        <small className="muted">{filteredAlerts.length} of {alerts.length} events</small>
      </div>
      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {filteredAlerts.length === 0 ? <p className="muted">No matching signal events.</p> :
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead><tr><th style={{ textAlign: "left" }}>Time</th><th style={{ textAlign: "left" }}>Camera</th>
              <th style={{ textAlign: "left" }}>Signal</th><th style={{ textAlign: "left" }}>Event</th><th style={{ textAlign: "left" }}>Review</th></tr></thead>
            <tbody>{filteredAlerts.map(alert => <tr key={alert.id} style={{ borderTop: "1px solid var(--border-color, #8884)", opacity: alert.acknowledged ? 0.7 : 1 }}>
              <td>{new Date(alert.at).toLocaleString()}</td><td>{alert.cameraName}</td>
              <td>{alert.kind}</td>
              <td style={{ color: alert.level === "warning" ? "#b63d3d" : "#1b8155" }}>{alert.level === "warning" ? `${alert.severity === "critical" ? "Critical" : "Warning"}: ` : "Recovered: "}{alert.message}</td>
              <td><button type="button" onClick={() => acknowledge(alert.id)} aria-label={`${alert.acknowledged ? "Unacknowledge" : "Acknowledge"} ${alert.cameraName} ${alert.message}`}>
                {alert.acknowledged ? "Reviewed" : "Acknowledge"}</button></td>
            </tr>)}</tbody>
          </table>}
      </div>
    </div>}
  </section>;
}

function CaptureQualityPanel() {
  const [quality, setQuality] = useState<CaptureQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [capabilities, setCapabilities] = useState<CameraCapabilityResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [perCameraQuality, setPerCameraQuality] = useState({
    width: 1920, height: 1080, fps: 30, recordingBitrateMbps: 12, streamingBitrateKbps: 4500
  });
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityNotice, setQualityNotice] = useState("");
  const [bulkPreset, setBulkPreset] = useState("standard-1080p30");
  const [bulkTargets, setBulkTargets] = useState<string[]>([]);
  const [bulkQualityBusy, setBulkQualityBusy] = useState(false);
  const [bulkQualityNotice, setBulkQualityNotice] = useState("");
  const presets = [
    { id: "standard-1080p30", name: "Standard 1080p30 (12 Mbps)" },
    { id: "high-1080p60", name: "High quality 1080p60 (16 Mbps)" },
    { id: "usb-light-720p30", name: "Reduced USB load 720p30 (6 Mbps)" }
  ];
  async function applyBulkPreset() {
    if (!bulkTargets.length) return;
    if (!window.confirm(`Apply ${bulkPreset} to ${bulkTargets.length} selected cameras? Changes take effect on their next recording.`)) return;
    setBulkQualityBusy(true); setError(null); setBulkQualityNotice("");
    try {
      const response = await fetch("/api/camera-quality/apply-preset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: bulkPreset, cameraIds: bulkTargets })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setBulkQualityNotice(`Applied ${bulkPreset} to ${result.updated} cameras. Restart their recordings to use the new settings.`);
      if (selectedCamera && bulkTargets.includes(selectedCamera)) setPerCameraQuality(result.quality);
    } catch (cause) { setError(String(cause)); }
    finally { setBulkQualityBusy(false); }
  }

  useEffect(() => {
    if (!selectedCamera) return;
    let alive = true;
    setQualityNotice("");
    fetch(`/api/camera-quality/${encodeURIComponent(selectedCamera)}`)
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(result => { if (alive) setPerCameraQuality(result.quality); })
      .catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [selectedCamera]);
  async function updateCameraQuality(reset = false) {
    if (!selectedCamera) return;
    setQualityBusy(true); setError(null); setQualityNotice("");
    try {
      const response = await fetch(`/api/camera-quality/${encodeURIComponent(selectedCamera)}`, {
        method: reset ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(reset ? {} : { body: JSON.stringify(perCameraQuality) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setPerCameraQuality(result.quality);
      setQualityNotice(reset ? "Camera override cleared." : "Saved. Applies when this camera next starts recording.");
    } catch (cause) { setError(String(cause)); }
    finally { setQualityBusy(false); }
  }

  useEffect(() => {
    fetch("/api/devices").then(response => response.json()).then((data: DeviceList) => {
      setCameras(data.cameras);
    }).catch(() => {});
  }, []);
  async function probeSelectedCamera() {
    if (!selectedCamera) return;
    setProbeBusy(true); setError(null); setCapabilities(null);
    try {
      const response = await fetch(`/api/cameras/${encodeURIComponent(selectedCamera)}/capabilities`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setCapabilities(data as CameraCapabilityResult);
    } catch (cause) { setError(String(cause)); }
    finally { setProbeBusy(false); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/capture-quality").then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<CaptureQuality>;
    }).then(data => { if (active) setQuality(data); })
      .catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  return <section aria-label="Capture quality settings" className="overview">
    <h2>Capture and Streaming Quality</h2>
    {error && <p role="alert">Quality settings unavailable: {error}</p>}
    {quality && <p>Recording input: {quality.inputWidth}×{quality.inputHeight} at {quality.recordingFps} fps,
      target bitrate {quality.recordingBitrate}. YouTube output: {quality.streamingWidth}×{quality.streamingHeight}
      at {quality.streamingFps} fps, target bitrate {quality.streamingBitrate}. Preview: {quality.previewFps} fps.</p>}
    <fieldset disabled={bulkQualityBusy || qualityBusy}>
      <legend>Bulk quality presets</legend>
      <label>Preset <select value={bulkPreset} onChange={event => setBulkPreset(event.target.value)}>
        {presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div><button type="button" onClick={() => setBulkTargets(cameras.map(item => item.id))}>Select all connected</button>
        <button type="button" onClick={() => setBulkTargets([])}>Clear selection</button></div>
      {cameras.map(camera => <label key={camera.id} style={{ display: "block" }}>
        <input type="checkbox" checked={bulkTargets.includes(camera.id)}
          onChange={event => setBulkTargets(previous => event.target.checked ?
            [...previous.filter(id => id !== camera.id), camera.id] : previous.filter(id => id !== camera.id))}/>
        {camera.displayName || camera.name}
      </label>)}
      <button type="button" disabled={!bulkTargets.length || bulkQualityBusy}
        onClick={() => void applyBulkPreset()}>
        {bulkQualityBusy ? "Applying..." : `Apply preset to ${bulkTargets.length} camera(s)`}
      </button>
      {bulkQualityNotice && <p role="status">{bulkQualityNotice}</p>}
      <p>Presets apply only to new recordings. 1080p60 requires camera and USB controller support.
        The 720p preset reduces camera input bandwidth; YouTube output remains configured at 1080p30.</p>
    </fieldset>
    <div>
      <label>Camera mode detection: <select value={selectedCamera} onChange={event => {
        setSelectedCamera(event.target.value); setCapabilities(null);
      }}><option value="">Choose camera</option>{cameras.map(camera =>
        <option key={camera.id} value={camera.id}>{camera.displayName || camera.name}</option>)}</select></label>
      <button type="button" disabled={!selectedCamera || probeBusy} onClick={() => void probeSelectedCamera()}>
        {probeBusy ? "Detecting..." : "Detect Supported Modes"}</button>
      {selectedCamera && <fieldset disabled={qualityBusy}>
        <legend>Per-camera recording and streaming quality</legend>
        <label>Width <input type="number" min="320" max="3840" step="1"
          value={perCameraQuality.width} onChange={event => setPerCameraQuality(q => ({ ...q, width: Number(event.target.value) }))}/></label>
        <label>Height <input type="number" min="240" max="2160" step="1"
          value={perCameraQuality.height} onChange={event => setPerCameraQuality(q => ({ ...q, height: Number(event.target.value) }))}/></label>
        <label>Capture/record FPS <input type="number" min="1" max="120" step="1"
          value={perCameraQuality.fps} onChange={event => setPerCameraQuality(q => ({ ...q, fps: Number(event.target.value) }))}/></label>
        <label>Recording bitrate (Mbps) <input type="number" min="1" max="100" step="1"
          value={perCameraQuality.recordingBitrateMbps} onChange={event => setPerCameraQuality(q => ({ ...q, recordingBitrateMbps: Number(event.target.value) }))}/></label>
        <label>YouTube bitrate (kbps) <input type="number" min="500" max="20000" step="100"
          value={perCameraQuality.streamingBitrateKbps} onChange={event => setPerCameraQuality(q => ({ ...q, streamingBitrateKbps: Number(event.target.value) }))}/></label>
        <button type="button" onClick={() => void updateCameraQuality()}>Save Camera Quality</button>
        <button type="button" onClick={() => void updateCameraQuality(true)}>Reset to Defaults</button>
        {qualityNotice && <p role="status">{qualityNotice}</p>}
        <p>Streaming stays at 1080p30; resolution and FPS here control the camera input and local recording.
          Confirm the camera supports the selected input mode using Detect Supported Modes.</p>
      </fieldset>}
      {capabilities && <div role="status">
        <p>{capabilities.detected ? `${capabilities.modes.length} MJPEG modes detected.` :
          `Unable to detect modes: ${capabilities.error || "unknown error"}`}</p>
        <p>Selected 1080p mode: {capabilities.selectedMode ?
          `${capabilities.selectedMode.width}×${capabilities.selectedMode.height} @ ${capabilities.selectedMode.fps} fps` :
          "None detected"}</p>
        {capabilities.modes.slice(0, 16).map((mode, index) => <p key={index}>
          {mode.width}×{mode.height} @ {mode.fps} fps ({mode.pixelFormat})</p>)}
      </div>}
    </div>
    <p>60 fps recording is opt-in using TOURNAMENT_CAPTURE_FPS=60 before starting the backend.
      Camera MJPEG mode and USB bandwidth must support 1080p60. These are configured targets,
      not independently verified recording frame rates.</p>
  </section>;
}

interface SystemResourceSnapshot {
  checkedAt: string;
  host: { platform: string; cpuModel: string; logicalCores: number };
  cpu: { utilizationPercent: number | null; source: string };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; nodeRssBytes: number };
  disk: { readBytesPerSec: number | null; writeBytesPerSec: number | null;
    busyPercent: number | null; source: string };
  gpu: null | { name: string; utilizationPercent: number | null;
    memoryUtilizationPercent: number | null; memoryUsedMiB: number | null;
    memoryTotalMiB: number | null; temperatureC: number | null };
  notes: string[];
}
function StressResourceSummary({ report, cameraResults }: {
  report: StressResourceReport; cameraResults: StressResult[];
}) {
  const readings = report.readings;
  const summary = (values: Array<number | null | undefined>, suffix: string, scale = 1) => {
    const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!valid.length) return "Unavailable";
    const min = Math.min(...valid) / scale;
    const max = Math.max(...valid) / scale;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length / scale;
    return `${min.toFixed(1)} / ${avg.toFixed(1)} / ${max.toFixed(1)} ${suffix}`;
  };
  const rows = [
    { name: "CPU utilization", values: readings.map(r => r.cpu.utilizationPercent), unit: "%", scale: 1 },
    { name: "RAM used", values: readings.map(r => r.memory.usedBytes), unit: "GiB", scale: 1073741824 },
    { name: "GPU utilization", values: readings.map(r => r.gpu?.utilizationPercent), unit: "%", scale: 1 },
    { name: "GPU memory used", values: readings.map(r => r.gpu?.memoryUsedMiB), unit: "MiB", scale: 1 },
    { name: "Disk write throughput", values: readings.map(r => r.disk.writeBytesPerSec), unit: "MiB/s", scale: 1048576 },
    { name: "Disk busy", values: readings.map(r => r.disk.busyPercent), unit: "%", scale: 1 }
  ];
  const failed = cameraResults.filter(r => r.status === "failed").length;
  const warnings = cameraResults.filter(r => r.status === "warning").length;
  return <div className="bulk-results" aria-label="Stress test system resource report">
    <h3>System resources during the 30-second test</h3>
    <p>{readings.length} resource samples collected; {report.failures} unavailable.
      Camera results: {cameraResults.length - failed - warnings} passed, {warnings} warnings, {failed} failed.</p>
    <table><thead><tr><th>Metric</th><th>Minimum / Average / Maximum</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.name}><td>{row.name}</td>
        <td>{summary(row.values, row.unit, row.scale)}</td></tr>)}
    </tbody></table>
    <details><summary>Individual system readings</summary>
      <table><thead><tr><th>Time</th><th>CPU</th><th>GPU</th><th>Disk write</th></tr></thead><tbody>
        {readings.map((r, index) => <tr key={`${r.checkedAt}-${index}`}>
          <td>{new Date(r.checkedAt).toLocaleTimeString()}</td>
          <td>{r.cpu.utilizationPercent === null ? "N/A" : `${r.cpu.utilizationPercent.toFixed(1)}%`}</td>
          <td>{r.gpu?.utilizationPercent == null ? "N/A" : `${r.gpu.utilizationPercent.toFixed(1)}%`}</td>
          <td>{r.disk.writeBytesPerSec === null ? "N/A" : `${(r.disk.writeBytesPerSec / 1048576).toFixed(1)} MiB/s`}</td>
        </tr>)}
      </tbody></table>
    </details>
    <small>Samples are approximate and may not coincide exactly with camera failures. GPU is device-wide, not NVENC-specific;
      disk counters are system-wide. No automated bottleneck attribution is made. Results remain in this dashboard session only.</small>
  </div>;
}

function SystemResourceMonitor({ requestNode }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [snapshot, setSnapshot] = useState<SystemResourceSnapshot | null>(null);
  const [history, setHistory] = useState<SystemResourceSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formatPercent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;
  const formatRate = (value: number | null) => value === null ? "Unavailable" : `${(value / 1048576).toFixed(1)} MiB/s`;
  async function sample() {
    setBusy(true); setError("");
    try {
      const result = await requestNode("/api/system/resources") as SystemResourceSnapshot;
      setSnapshot(result);
      setHistory(previous => [...previous.slice(-19), result]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="System resource monitoring">
    <h2>System Resource Snapshot</h2>
    <p>Inspect CPU, memory, NVIDIA GPU, and disk activity while cameras are recording.
      Click repeatedly during a stress test to collect up to 20 local snapshots.</p>
    <button type="button" disabled={busy} onClick={() => void sample()}>
      {busy ? "Sampling resources..." : "Sample System Resources"}</button>
    <button type="button" onClick={() => setHistory([])} disabled={history.length === 0}>Clear Samples</button>
    {error && <p role="alert">Resource sample failed: {error}</p>}
    {snapshot && <>
      <p>Checked: {new Date(snapshot.checkedAt).toLocaleString()}.
        {` ${snapshot.host.cpuModel} (${snapshot.host.logicalCores} logical cores)`}</p>
      <table><thead><tr><th>Metric</th><th>Latest reading</th></tr></thead><tbody>
        <tr><td>CPU utilization</td><td>{formatPercent(snapshot.cpu.utilizationPercent)}</td></tr>
        <tr><td>System RAM used / total</td><td>{(snapshot.memory.usedBytes / 1073741824).toFixed(1)} /
          {(snapshot.memory.totalBytes / 1073741824).toFixed(1)} GiB</td></tr>
        <tr><td>Node service RAM (RSS)</td><td>{(snapshot.memory.nodeRssBytes / 1048576).toFixed(1)} MiB</td></tr>
        <tr><td>Physical disk read</td><td>{formatRate(snapshot.disk.readBytesPerSec)}</td></tr>
        <tr><td>Physical disk write</td><td>{formatRate(snapshot.disk.writeBytesPerSec)}</td></tr>
        <tr><td>Physical disk busy</td><td>{formatPercent(snapshot.disk.busyPercent)}</td></tr>
        <tr><td>NVIDIA GPU</td><td>{snapshot.gpu ? `${snapshot.gpu.name}: ${formatPercent(snapshot.gpu.utilizationPercent)}` : "Unavailable"}</td></tr>
        <tr><td>GPU memory used</td><td>{snapshot.gpu && snapshot.gpu.memoryUsedMiB !== null ?
          `${snapshot.gpu.memoryUsedMiB} MiB` : "Unavailable"}</td></tr>
        <tr><td>GPU temperature</td><td>{snapshot.gpu?.temperatureC !== null && snapshot.gpu?.temperatureC !== undefined ?
          `${snapshot.gpu.temperatureC} °C` : "Unavailable"}</td></tr>
      </tbody></table>
      <p>Collected {history.length} snapshot{history.length === 1 ? "" : "s"} in this browser session.</p>
      {history.length > 1 && <table><thead><tr><th>Sample</th><th>CPU</th><th>GPU</th><th>Disk write</th></tr></thead><tbody>
        {history.map((item, index) => <tr key={`${item.checkedAt}-${index}`}>
          <td>{new Date(item.checkedAt).toLocaleTimeString()}</td>
          <td>{formatPercent(item.cpu.utilizationPercent)}</td>
          <td>{formatPercent(item.gpu?.utilizationPercent ?? null)}</td>
          <td>{formatRate(item.disk.writeBytesPerSec)}</td>
        </tr>)}
      </tbody></table>}
      <p>{snapshot.notes.join(" ")}</p>
    </>}
  </section>;
}

interface HardwareReportSnapshot {
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
type RingSignoffCheck = "position" | "audio" | "recording" | "playback" | "backup";
const ringSignoffChecks: Array<{ id: RingSignoffCheck; label: string }> = [
  { id: "position", label: "Camera position, focus, framing and ring identification checked" },
  { id: "audio", label: "Correct microphone selected; speech and ambient audio listened to" },
  { id: "recording", label: "Local recording reviewed for resolution, frame rate and audio" },
  { id: "playback", label: "YouTube destination verified by watching and listening on another device" },
  { id: "backup", label: "Recovery steps, spare cable and local recording fallback reviewed" }
];
type RingSignoffEntry = { checked: Partial<Record<RingSignoffCheck, boolean>>; notes: string };
type RingSignoffDocument = {
  schemaVersion: 1; eventId: string | null; eventName: string; nodeId: string;
  assignmentFingerprint: string; updatedAt: string; operator: string;
  signedAt: string | null; rings: Record<string, RingSignoffEntry>;
};
function RingPreTournamentSignoff({ nodeId, eventId, eventName, assignments }: {
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

function TournamentHardwareReport({ requestNode, nodeId, eventName, eventId, assignments,
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

interface UsbDiagnostic {
  friendlyName: string;
  instanceId: string;
  locationPaths: string[];
  busHint: string | null;
  status: string;
  vendorId?: string | null;
  productId?: string | null;
  containerId?: string | null;
  serialCandidate?: string | null;
  identityConfidence?: "serial-candidate" | "container-session" | "model-only";
}
interface UsbBandwidthReport {
  checkedAt: string;
  cameras: Array<{ cameraId: string; cameraName: string; width: number; height: number;
    fps: number; mjpegLowMbps: number; mjpegHighMbps: number; uncompressedYuy2Mbps: number }>;
  totals: { mjpegLowMbps: number; mjpegHighMbps: number; uncompressedYuy2Mbps: number };
  assumptions: { note: string };
}
function UsbBandwidthPlanner({ requestNode, stressResults, stressBusy }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
  stressResults: StressResult[] | null;
  stressBusy: boolean;
}) {
  const [report, setReport] = useState<UsbBandwidthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = ["Motherboard group A", "Motherboard group B", "PCIe USB card", "Unassigned"];
  const [placements, setPlacements] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("tournament-usb-plan-v1") || "{}"); }
    catch { return {}; }
  });
  function assign(cameraId: string, group: string) {
    setPlacements(previous => {
      const next = { ...previous, [cameraId]: group };
      try { localStorage.setItem("tournament-usb-plan-v1", JSON.stringify(next)); }
      catch { /* browser storage unavailable */ }
      return next;
    });
  }
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/usb/bandwidth-estimate")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="USB bandwidth planning estimates">
    <h2>USB Bandwidth Planner</h2>
    <p>Estimated USB camera-input traffic using saved resolution and frame-rate settings.
      MJPEG compression depends on the scene and camera, so these figures are planning ranges, not measurements.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Estimating..." : "Estimate USB Camera Bandwidth"}
    </button>
    {error && <p role="alert">Bandwidth estimate failed: {error}</p>}
    {report && <div role="status">
      <p>Checked {new Date(report.checkedAt).toLocaleString()}.</p>
      <table><thead><tr><th>Camera</th><th>Configured input</th><th>MJPEG estimate</th><th>YUY2 hypothetical</th><th>Planned group</th></tr></thead>
        <tbody>{report.cameras.map(camera => <tr key={camera.cameraId}>
          <td>{camera.cameraName}</td>
          <td>{camera.width}×{camera.height} @ {camera.fps} fps</td>
          <td>{camera.mjpegLowMbps}–{camera.mjpegHighMbps} Mbps</td>
          <td>{camera.uncompressedYuy2Mbps} Mbps</td>
          <td><select aria-label={`USB group for ${camera.cameraName}`}
            value={groups.includes(placements[camera.cameraId]) ? placements[camera.cameraId] : "Unassigned"}
            onChange={event => assign(camera.cameraId, event.target.value)}>
            {groups.map(group => <option key={group} value={group}>{group}</option>)}
          </select></td>
        </tr>)}</tbody>
        <tfoot><tr><th>Total</th><th>{report.cameras.length} cameras</th>
          <th>{report.totals.mjpegLowMbps}–{report.totals.mjpegHighMbps} Mbps</th>
          <th>{report.totals.uncompressedYuy2Mbps} Mbps</th><th>Manual plan</th></tr></tfoot>
      </table>
      <h3>Planned USB groups</h3>
      <p>These are manual planning labels, not automatically detected USB host controllers.
        Motherboard ports and PCIe card ports may share controllers.</p>
      <table><thead><tr><th>Planned group</th><th>Cameras</th><th>Estimated MJPEG traffic</th><th>Advice</th></tr></thead>
        <tbody>{groups.map(group => {
          const cameras = report.cameras.filter(camera =>
            (groups.includes(placements[camera.cameraId]) ? placements[camera.cameraId] : "Unassigned") === group);
          const low = cameras.reduce((sum, camera) => sum + camera.mjpegLowMbps, 0);
          const high = cameras.reduce((sum, camera) => sum + camera.mjpegHighMbps, 0);
          return <tr key={group}><td>{group}</td><td>{cameras.length}</td>
            <td>{low.toFixed(1)}–{high.toFixed(1)} Mbps</td>
            <td>{group === "Unassigned" ? "Assign cameras to a group" :
              cameras.length >= 4 ? "High camera count: verify topology and stress-test" :
              cameras.length >= 2 ? "Verify topology and stress-test" : "Verify topology"}</td>
          </tr>;
        })}</tbody>
      </table>
      <h3>Latest stress-test results by planned USB group</h3>
      <p>This correlates the latest 30-second recording stress test with your manually assigned USB groups.
        It is a diagnostic association, not proof that USB bandwidth caused a recording problem.
        Group assignments changed after the test may invalidate the comparison.</p>
      {stressBusy && <p role="status">Stress test in progress. Results below are not yet updated.</p>}
      {!stressResults && <p>No completed stress test in this dashboard session. Start recordings on at least
        two cameras and run the 30-second multi-camera test above.</p>}
      {stressResults && <table><thead><tr><th>Planned group</th><th>Tested</th>
        <th>Pass</th><th>Warning</th><th>Failed</th><th>Observed issues</th></tr></thead>
        <tbody>{groups.map(group => {
          const members = stressResults.filter(result =>
            (groups.includes(placements[result.cameraId]) ? placements[result.cameraId] : "Unassigned") === group);
          const failed = members.filter(result => result.status === "failed").length;
          const warnings = members.filter(result => result.status === "warning").length;
          const issues = members.filter(result => result.status !== "pass")
            .map(result => `${result.cameraName}: ${result.status}`);
          return <tr key={group}><td>{group}</td><td>{members.length}</td>
            <td>{members.filter(result => result.status === "pass").length}</td>
            <td>{warnings}</td><td>{failed}</td>
            <td>{issues.length ? issues.join("; ") : members.length ? "No issues detected" : "Not tested"}</td>
          </tr>;
        })}</tbody></table>}
      {stressResults && <p>{stressResults.filter(result => result.status !== "pass").length > 0
        ? "Some cameras reported recording problems. Review camera logs, USB topology, CPU/GPU load, and disk throughput before attributing failures to USB bandwidth."
        : "All sampled cameras passed this test. This does not guarantee reliability over a full tournament."}</p>}
      <p>Start by distributing high-FPS cameras across independently verified controllers.
        Confirm the actual USB tree in Windows Device Manager, then run the multi-camera stress test.
        Estimates exclude USB overhead and are not measured controller utilization.</p>
      <p>{report.assumptions.note}</p>
      <p>Totals assume all listed cameras share one link, which is a worst-case planning assumption.
        They cannot determine whether a particular USB controller will handle the load.
        Verify controller connections in Device Manager and run the multi-camera recording stress test.</p>
    </div>}
  </section>;
}

interface CameraMaintenanceSchedule {
  id: string; task: string; intervalDays: number; nextDue: string; lastCompletedAt?: string;
}
interface CameraAssetRecord {
  label: string; model: string; serial: string; purchasedOn: string; warrantyUntil: string;
  notes: string; maintenance: { id: string; at: string; action: string; notes: string }[];
  schedules?: CameraMaintenanceSchedule[];
}
function maintenanceDueDate(date: Date, days: number): string {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
function maintenanceStatus(due: string, today: string): "Overdue" | "Due today" | "Upcoming" {
  return due < today ? "Overdue" : due === today ? "Due today" : "Upcoming";
}
function CameraAssetInventory({ nodeId }: { nodeId: string }) {
  const storageKey = `tournament-camera-assets-v1:${nodeId}`;
  const [assets, setAssets] = useState<CameraAssetRecord[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(value) ? value.filter((item): item is CameraAssetRecord =>
        !!item && typeof item.label === "string" && Array.isArray(item.maintenance)).slice(0, 100) : [];
    } catch { return []; }
  });
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const [action, setAction] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [scheduleTask, setScheduleTask] = useState("");
  const [scheduleDays, setScheduleDays] = useState(90);
  const [scheduleDue, setScheduleDue] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const scheduled = assets.flatMap(asset => (asset.schedules || []).map(item => ({ ...item, camera: asset.label })));
  const overdue = scheduled.filter(item => item.nextDue < today).length;
  const dueToday = scheduled.filter(item => item.nextDue === today).length;
  const [message, setMessage] = useState("");
  const current = assets.find(asset => asset.label === selected);
  function persist(next: CameraAssetRecord[]) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setAssets(next); setMessage("Inventory saved in this browser."); }
    catch { setMessage("Could not save inventory. Export a backup before leaving this page."); }
  }
  function update(patch: Partial<CameraAssetRecord>) {
    if (!current) return;
    persist(assets.map(asset => asset.label === selected ? { ...asset, ...patch } : asset));
  }
  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, nodeId, exportedAt: new Date().toISOString(), assets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `camera-equipment-${nodeId}.json`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="overview" aria-label="Camera equipment inventory">
    <h2>Physical Camera Equipment Inventory</h2>
    <p>Track labelled cameras, purchase and warranty dates, and maintenance performed. Records are
      browser-local to this capture node. Use the same labels as confirmed physical camera associations.</p>
    <label>New physical camera label <input value={label} maxLength={80} placeholder="S600-A"
      onChange={e => setLabel(e.target.value)} /></label>{" "}
    <button type="button" onClick={() => {
      const value = label.trim();
      if (!value || assets.some(asset => asset.label.toLowerCase() === value.toLowerCase())) {
        setMessage("Enter a unique nonempty physical camera label."); return;
      }
      if (assets.length >= 100) { setMessage("Inventory limit reached (100 cameras)."); return; }
      persist([...assets, { label: value, model: "", serial: "", purchasedOn: "", warrantyUntil: "", notes: "", maintenance: [] }]);
      setSelected(value); setLabel("");
    }}>Add camera</button>{" "}
    <button type="button" onClick={download} disabled={!assets.length}>Export equipment JSON</button>
    <p role="status">{message}</p>
    <p>{assets.length} physical cameras in this browser inventory.</p>
    <h3>Maintenance reminders</h3>
    <p><strong>{overdue} overdue</strong>, {dueToday} due today, {scheduled.length} scheduled tasks total.
      Reminders appear only when this dashboard is opened; no background notifications are sent.</p>
    {scheduled.length > 0 && <table><thead><tr><th>Camera</th><th>Task</th><th>Next due</th><th>Interval</th><th>Status</th></tr></thead>
      <tbody>{[...scheduled].sort((a,b) => a.nextDue.localeCompare(b.nextDue)).map(item => <tr key={`${item.camera}:${item.id}`}>
        <td>{item.camera}</td><td>{item.task}</td><td>{item.nextDue}</td><td>{item.intervalDays} days</td>
        <td>{maintenanceStatus(item.nextDue, today)}</td></tr>)}</tbody></table>}
    {assets.length > 0 && <><label>Choose camera{" "}<select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">Select a camera</option>
      {assets.map(asset => <option key={asset.label} value={asset.label}>{asset.label}</option>)}
    </select></label></>}
    {current && <div>
      <h3>{current.label}</h3>
      <p><label>Model <input value={current.model} maxLength={120} onChange={e => update({ model: e.target.value })} /></label>{" "}
      <label>Manufacturer serial (verified manually) <input value={current.serial} maxLength={120} onChange={e => update({ serial: e.target.value })} /></label></p>
      <p><label>Purchase date <input type="date" value={current.purchasedOn} onChange={e => update({ purchasedOn: e.target.value })} /></label>{" "}
      <label>Warranty end date <input type="date" value={current.warrantyUntil} onChange={e => update({ warrantyUntil: e.target.value })} /></label></p>
      <label>Equipment notes <textarea value={current.notes} maxLength={2000} rows={2} onChange={e => update({ notes: e.target.value })} /></label>
      {current.warrantyUntil && <p>Warranty end: {current.warrantyUntil}
        {current.warrantyUntil < new Date().toISOString().slice(0, 10) ? " (past date)" : " (upcoming or today)"}.
        Check purchase documentation for actual coverage.</p>}
      <h4>Scheduled maintenance ({(current.schedules || []).length})</h4>
      <p>Schedule recurring checks such as lens cleaning, USB cable inspection, or a recording test.
        Completion logs the task and schedules the next due date from the completion date.</p>
      <label>Task <input value={scheduleTask} maxLength={120} placeholder="Inspect USB cable"
        onChange={e => setScheduleTask(e.target.value)} /></label>{" "}
      <label>Repeat every (days) <input type="number" min={1} max={3650} value={scheduleDays}
        onChange={e => setScheduleDays(Number(e.target.value))} /></label>{" "}
      <label>First due date <input type="date" value={scheduleDue} onChange={e => setScheduleDue(e.target.value)} /></label>{" "}
      <button type="button" onClick={() => {
        const task = scheduleTask.trim();
        if (!task || !Number.isInteger(scheduleDays) || scheduleDays < 1 || scheduleDays > 3650 ||
            (scheduleDue && !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDue))) {
          setMessage("Enter a task, a valid interval of 1 to 3650 days, and an optional due date."); return;
        }
        if ((current.schedules || []).length >= 50) { setMessage("Schedule limit reached (50 per camera)."); return; }
        const entry: CameraMaintenanceSchedule = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          task, intervalDays: scheduleDays, nextDue: scheduleDue || maintenanceDueDate(new Date(), scheduleDays) };
        update({ schedules: [...(current.schedules || []), entry] }); setScheduleTask(""); setScheduleDue("");
      }}>Add recurring task</button>
      {(current.schedules || []).length > 0 && <table><thead><tr><th>Task</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{(current.schedules || []).map(item => <tr key={item.id}>
          <td>{item.task} (every {item.intervalDays} days)</td><td>{item.nextDue}</td>
          <td>{maintenanceStatus(item.nextDue, today)}</td><td>
            <button type="button" onClick={() => {
              if (current.maintenance.length >= 200) { setMessage("Maintenance log full; remove older entries before completing tasks."); return; }
              const now = new Date();
              const entry = { id: `${Date.now()}-${item.id}`, at: now.toISOString(), action: item.task,
                notes: `Scheduled maintenance completed; previous due ${item.nextDue}.` };
              update({ maintenance: [...current.maintenance, entry], schedules: (current.schedules || []).map(sched =>
                sched.id === item.id ? { ...sched, lastCompletedAt: now.toISOString(), nextDue: maintenanceDueDate(now, sched.intervalDays) } : sched) });
            }}>Mark completed</button>{" "}
            <button type="button" onClick={() => {
              if (window.confirm(`Remove scheduled task ${item.task}?`))
                update({ schedules: (current.schedules || []).filter(sched => sched.id !== item.id) });
            }}>Remove</button>
          </td></tr>)}</tbody></table>}
      <h4>Maintenance log ({current.maintenance.length})</h4>
      <label>Action <input value={action} maxLength={120} placeholder="Replaced USB cable" onChange={e => setAction(e.target.value)} /></label>{" "}
      <label>Notes <input value={maintenanceNotes} maxLength={1000} onChange={e => setMaintenanceNotes(e.target.value)} /></label>{" "}
      <button type="button" onClick={() => {
        if (!action.trim()) { setMessage("Enter a maintenance action."); return; }
        if (current.maintenance.length >= 200) { setMessage("Maintenance log limit reached (200 per camera)."); return; }
        const entry = { id: `${Date.now()}-${current.maintenance.length}`, at: new Date().toISOString(), action: action.trim(), notes: maintenanceNotes.trim() };
        update({ maintenance: [...current.maintenance, entry] }); setAction(""); setMaintenanceNotes("");
      }}>Log maintenance</button>
      <ul>{[...current.maintenance].reverse().map(entry => <li key={entry.id}>
        {new Date(entry.at).toLocaleString()}: <strong>{entry.action}</strong> {entry.notes}
        {" "}<button type="button" onClick={() => {
          if (window.confirm("Delete this maintenance entry?")) update({ maintenance: current.maintenance.filter(item => item.id !== entry.id) });
        }}>Remove</button>
      </li>)}</ul>
      <button type="button" onClick={() => {
        if (!window.confirm(`Delete equipment record ${current.label} and its maintenance log?`)) return;
        persist(assets.filter(asset => asset.label !== selected)); setSelected("");
      }}>Delete equipment record</button>
    </div>}
    <p>Equipment labels and serial fields are entered manually. This inventory does not automatically identify
      connected hardware or synchronize across browsers. Export backups before clearing browser data.</p>
  </section>;
}

interface UsbInventorySnapshot { checkedAt: string; devices: UsbDiagnostic[] }
function UsbTopologyDiagnostics({ requestNode, nodeId }: { requestNode: (url: string, options?: RequestInit) => Promise<any>; nodeId: string }) {
  const [data, setData] = useState<{ supported: boolean; devices: UsbDiagnostic[]; warning: string | null; checkedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyKey = `tournament-usb-fingerprint-history-v1:${nodeId}`;
  const [history, setHistory] = useState<UsbInventorySnapshot[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((x): x is UsbInventorySnapshot =>
        !!x && typeof x.checkedAt === "string" && Array.isArray(x.devices)).slice(-25) : [];
    } catch { return []; }
  });
  const [historyWarning, setHistoryWarning] = useState("");
  const [previousInventory, setPreviousInventory] = useState<UsbDiagnostic[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("tournament-physical-camera-identities-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch { return {}; }
  });
  const [confirmLabels, setConfirmLabels] = useState<Record<string, string>>({});
  const [confirmCameraIds, setConfirmCameraIds] = useState<Record<string, string>>({});
  const historicalDevices = history.flatMap(snapshot => snapshot.devices.map(device => ({ ...device, observedAt: snapshot.checkedAt })));
  function candidateMatches(device: UsbDiagnostic) {
    return historicalDevices.filter(old => old.instanceId !== device.instanceId &&
      device.vendorId && device.productId && old.vendorId === device.vendorId && old.productId === device.productId &&
      ((device.serialCandidate && old.serialCandidate === device.serialCandidate) ||
       (device.containerId && old.containerId === device.containerId)))
      .filter((item, index, all) => all.findIndex(other => other.instanceId === item.instanceId) === index).slice(0, 8);
  }
  function confirmIdentity(device: UsbDiagnostic) {
    const label = (confirmLabels[device.instanceId] || "").trim().slice(0, 80);
    const cameraId = (confirmCameraIds[device.instanceId] || "").trim();
    if (!label || !cameraId || cameraId.length > 400) {
      setHistoryWarning("Enter a physical label and the exact camera ID from the recording report before confirming."); return;
    }
    const key = `${nodeId}::${cameraId}`;
    const next = { ...confirmed, [key]: label };
    try {
      localStorage.setItem("tournament-physical-camera-identities-v1", JSON.stringify(next));
      setConfirmed(next); setHistoryWarning(`Confirmed ${cameraId} as ${label}. Refresh the report archive to see updated groupings.`);
    } catch { setHistoryWarning("Browser storage is unavailable. Export your data before closing this page."); }
  }
  async function inspect() {
    setBusy(true); setError(null);
    try {
      const next = await requestNode("/api/usb/diagnostics");
      setPreviousInventory(data?.devices || []);
      setData(next);
      if (next.supported && Array.isArray(next.devices) && !next.warning) {
        const updated = [...history, { checkedAt: next.checkedAt, devices: next.devices }].slice(-25);
        try { localStorage.setItem(historyKey, JSON.stringify(updated)); setHistory(updated); }
        catch { setHistoryWarning("USB history could not be saved. Browser storage may be full."); }
      }
    }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="USB camera topology diagnostics">
    <h2>USB Camera Topology</h2>
    <p>Inspect Windows camera connection paths to help distribute cameras across USB ports.
      This is an inventory, not a bandwidth measurement or a verified controller map.</p>
    <button type="button" disabled={busy} onClick={() => void inspect()}>
      {busy ? "Inspecting USB devices..." : "Inspect USB Camera Connections"}
    </button>
    {error && <p role="alert">USB inspection failed: {error}</p>}
    {historyWarning && <p role="status">{historyWarning}</p>}
    <p>Saved inventory snapshots for this node: {history.length} (maximum 25, browser-local).</p>
    {history.length > 0 && <div>
      <button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify({ version: 1, nodeId, exportedAt: new Date().toISOString(), snapshots: history }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = `usb-fingerprint-history-${nodeId}.json`; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export saved fingerprint history</button>{" "}
      <button type="button" onClick={() => {
        if (!window.confirm("Clear saved USB inventory history for this capture node?")) return;
        try { localStorage.removeItem(historyKey); setHistory([]); setHistoryWarning(""); }
        catch { setHistoryWarning("Unable to clear USB history."); }
      }}>Clear saved history</button>
    </div>}
    {data && <div role="status">
      <p>Checked {new Date(data.checkedAt).toLocaleString()}. {data.devices.length} USB camera entries.</p>
      {data.warning && <p>{data.warning}</p>}
      {data.devices.map(device => <div key={device.instanceId}>
        <strong>{device.friendlyName || "Unnamed USB camera"}</strong> ({device.status})
        <p>Windows instance: <code>{device.instanceId}</code></p>
        <p>USB vendor/product: {device.vendorId && device.productId
          ? `${device.vendorId}:${device.productId}` : "Unavailable"}</p>
        <p>Windows container ID: <code>{device.containerId || "Unavailable"}</code></p>
        <p>Possible hardware serial: <code>{device.serialCandidate || "Not found"}</code></p>
        <p>Identity evidence: {device.identityConfidence === "serial-candidate"
          ? "Serial-like identifier, operator verification required"
          : device.identityConfidence === "container-session"
            ? "Windows container association, not permanent hardware identity"
            : "Model information only, not unique"}</p>
        {previousInventory.length > 0 && (() => {
          const matches = previousInventory.filter(old => old.instanceId !== device.instanceId &&
            ((device.serialCandidate && old.serialCandidate === device.serialCandidate &&
              old.vendorId === device.vendorId && old.productId === device.productId) ||
              (device.containerId && old.containerId === device.containerId)));
          return matches.length ? <p>Possible previous device entry: {matches.map(m => m.instanceId).join(", ")}.
            Confirm physically before linking identities.</p> : null;
        })()}
        {candidateMatches(device).length > 0 && <p>Saved-history possible matches: {candidateMatches(device).map(m =>
          `${m.instanceId} (${new Date(m.observedAt).toLocaleString()})`).join("; ")}. This is supporting evidence, not proof.</p>}
        <div>
          <label>Physical camera label{" "}<input value={confirmLabels[device.instanceId] || ""}
            placeholder="e.g. S600-A" maxLength={80}
            onChange={e => setConfirmLabels(old => ({ ...old, [device.instanceId]: e.target.value }))} /></label>{" "}
          <label>Exact report camera ID{" "}<input value={confirmCameraIds[device.instanceId] || ""}
            placeholder="Copy from recording report" maxLength={400}
            onChange={e => setConfirmCameraIds(old => ({ ...old, [device.instanceId]: e.target.value }))} /></label>{" "}
          <button type="button" onClick={() => confirmIdentity(device)}>Confirm physical association</button>
          {confirmed[`${nodeId}::${confirmCameraIds[device.instanceId] || ""}`] &&
            <p>Confirmed report identity: {confirmed[`${nodeId}::${confirmCameraIds[device.instanceId]}`]}</p>}
        </div>
        <p>Bus path hint: {device.busHint || "Not available"}</p>
        <p>Location: <code>{device.locationPaths[0] || "Not reported"}</code></p>
      </div>)}
      <p>USB vendor/product IDs identify a model, not an individual camera. Windows container IDs can
        change when devices are reconnected or moved. Serial-like instance suffixes are only candidates,
        not authenticated serial numbers. This view never merges physical camera histories automatically.
        Refresh the inventory after reconnecting a camera to compare entries.</p>
      <button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "usb-camera-hardware-fingerprints.json";
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export USB hardware inventory JSON</button>
      <p>Two devices with the same bus prefix are not necessarily on the same USB controller.
        Use Windows Device Manager (View → Devices by connection) to confirm the physical controller.
        USB utilization and negotiated speed are not measured here.</p>
    </div>}
  </section>;
}

export default function App() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [authError, setAuthError] = useState("");
  useEffect(() => { void request("/api/auth/status").then((data) => {
    setAuthConfigured(Boolean(data.configured)); setUnlocked(Boolean(data.unlocked));
  }).catch(() => {}); }, []);
  async function unlock() {
    try {
      const data = await request("/api/auth/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword })
      });
      operatorToken = data.token; setUnlocked(true); setAdminPassword(""); setAuthError("");
    } catch (error) { setAuthError(String(error)); }
  }
  async function lock() {
    try { await request("/api/auth/lock", { method: "POST" }); } catch { /* expire locally regardless */ }
    operatorToken = ""; setUnlocked(false);
  }
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result: { nodes: NodeInfo[] } = await request("/api/nodes");
        if (active) { setNodes(result.nodes); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Tournament Streaming</h1>
          <a href="/presentation?mode=rings" target="_blank" rel="noopener noreferrer">Open presentation display</a> <a href="/presentation?mode=billboard" target="_blank" rel="noopener noreferrer">Open billboard</a>
          <p className="muted">Multi-PC tournament control center</p>
        </div>
        <strong>{nodes.filter((node) => node.online).length} / {nodes.length} nodes online</strong>
      </header>
      {authConfigured && <section className="operator-panel" aria-label="Operator permissions">
        <strong>{unlocked ? "Operator unlocked (15-minute grant)" : "Read-only: operator locked"}</strong>
        {unlocked ? <button type="button" onClick={() => void lock()}>Lock controls</button> :
          <form onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
            <input type="password" autoComplete="current-password" placeholder="Operator password"
              aria-label="Operator password" value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)} />
            <button type="submit">Unlock controls</button>
          </form>}
        {authError && <span role="alert">{authError}</span>}
      </section>}
      {error && <div className="alert" role="alert">{error}</div>}
      {nodes.map((node) => (
        <div key={node.id} className="node-container">
          <div className={`node-indicator ${node.online ? "online" : "offline"}`}>
            <span className="status-dot" />
            {node.online ? "Online" : "Offline"}
          </div>
          {node.online ? <NodeDashboard node={node} /> : (
            <div className="node-offline">
              <strong>{node.name} is unreachable.</strong>
              <p>Its local recordings and streams may still be running. Control will return when the connection recovers.</p>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}

