import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface CaptureSignalSnapshot {
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

export type SignalAlertKind = "video" | "audio" | "connection";

export type SignalAlertLevel = "warning" | "recovered";

export interface SignalAlert {
  id: number;
  at: number;
  cameraName: string;
  kind: SignalAlertKind;
  level: SignalAlertLevel;
  message: string;
  acknowledged?: boolean;
  severity?: "warning" | "critical";
}

export function videoSignalState(item: CaptureSignalSnapshot["captures"][number]): string {
  if (typeof item.video.possibleFreezeMs === "number" && item.video.possibleFreezeMs > 0) return "possible-freeze";
  return item.video.status;
}

export function isVideoWarning(state: string): boolean {
  return state !== "receiving" && state !== "waiting";
}

export function isAudioWarning(state: string): boolean {
  return state === "no-audio-samples" || state === "audio-samples-stalled";
}

export interface SignalAlertRules {
  enabled: boolean;
  freezeWarningSeconds: number;
  staleFrameSeconds: number;
  missingAudioSeconds: number;
  consecutiveChecks: number;
  cooldownSeconds: number;
  alertOnSilence: boolean;
}

export const DEFAULT_SIGNAL_RULES: SignalAlertRules = {
  enabled: true, freezeWarningSeconds: 12, staleFrameSeconds: 5,
  missingAudioSeconds: 10, consecutiveChecks: 2, cooldownSeconds: 60,
  alertOnSilence: false
};

export function loadSignalRules(nodeId: string): SignalAlertRules {
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

export function classifiedSignal(item: CaptureSignalSnapshot["captures"][number], rules: SignalAlertRules): { video: string; audio: string } {
  const freeze = item.video.possibleFreezeMs;
  const age = item.video.frameAgeMs;
  const video = typeof age === "number" && age >= rules.staleFrameSeconds * 1000 ? "stalled" :
    typeof freeze === "number" && freeze >= rules.freezeWarningSeconds * 1000 ? "possible-freeze" : item.video.status;
  const sampleAge = item.audio.audioSampleAgeMs;
  const audio = item.audio.status === "audio-samples-stalled" && typeof sampleAge === "number" && sampleAge < rules.missingAudioSeconds * 1000 ? "audio-active" :
    item.audio.status === "no-audio-samples" && typeof sampleAge === "number" && sampleAge < rules.missingAudioSeconds * 1000 ? "unverified" : item.audio.status;
  return { video, audio };
}

export type CameraSignalOverride = { enabled: boolean; freezeWarningSeconds: number | null; staleFrameSeconds: number | null; missingAudioSeconds: number | null; alertOnSilence: boolean | null };

export const DEFAULT_CAMERA_OVERRIDE: CameraSignalOverride = { enabled: true, freezeWarningSeconds: null, staleFrameSeconds: null, missingAudioSeconds: null, alertOnSilence: null };

export function loadCameraSignalOverrides(nodeId: string): Record<string, CameraSignalOverride> {
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

export function cameraRules(base: SignalAlertRules, override?: CameraSignalOverride): SignalAlertRules {
  if (!override) return base;
  return { ...base, enabled: base.enabled && override.enabled,
    freezeWarningSeconds: override.freezeWarningSeconds ?? base.freezeWarningSeconds,
    staleFrameSeconds: override.staleFrameSeconds ?? base.staleFrameSeconds,
    missingAudioSeconds: override.missingAudioSeconds ?? base.missingAudioSeconds,
    alertOnSilence: override.alertOnSilence ?? base.alertOnSilence };
}

export function signalSeverity(kind: SignalAlertKind, state: string): "warning" | "critical" {
  return kind === "connection" || state === "stalled" || state === "no-audio-samples" || state === "audio-samples-stalled" ? "critical" : "warning";
}

export function CaptureSignalHealthPanel({ requestNode, nodeId }: {
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
    const timer = startPolling(refresh, 3000);
    return () => { mounted = false; timer(); };
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
