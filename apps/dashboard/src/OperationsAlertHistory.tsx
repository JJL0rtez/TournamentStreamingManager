import { useEffect, useRef, useState } from "react";
import { acknowledgementKey, acknowledgementEvent, readNotificationMarks, publishAcknowledgement, type Acknowledgement } from "./notification-ack";
export type OperationsAlertSeverity = "critical" | "warning";
export interface OperationsAlertInput { key: string; severity: OperationsAlertSeverity; message: string }
export interface OperationsAlertRecord extends OperationsAlertInput {
  firstSeen: string; lastSeen: string; acknowledgedAt?: string; resolvedAt?: string;
}
export function OperationsAlertHistory({ nodeId, eventId, alerts, online }: {
  nodeId: string; eventId: string; alerts: OperationsAlertInput[]; online: boolean;
}) {
  const storageKey = `tournament-operations-alerts-v1:${nodeId}:${eventId || "unsaved"}`;
  const [records, setRecords] = useState<OperationsAlertRecord[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
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
    setLoadedStorageKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    // Do not resolve alerts while disconnected or during incomplete initial data loading.
    if (!online || loadedStorageKey !== storageKey) return;
    const stamp = new Date().toISOString();
    setRecords(previous => {
      const current = new Map(alerts.map(a => [a.key, a]));
      const existing = new Set(previous.filter(r => !r.resolvedAt).map(r => r.key));
      const updated = previous.map(r => {
        if (r.resolvedAt) return r;
        const active = current.get(r.key);
        return active ? (active.message === r.message && active.severity === r.severity ? r :
          { ...r, message: active.message, severity: active.severity, lastSeen: stamp, acknowledgedAt: active.severity===r.severity ? r.acknowledgedAt : undefined }) :
          { ...r, resolvedAt: stamp, lastSeen: stamp };
      });
      for (const alert of alerts) if (!existing.has(alert.key))
        updated.unshift({ ...alert, firstSeen: stamp, lastSeen: stamp });
      return updated.slice(0, 200);
    });
  }, [online, loadedStorageKey, storageKey, alerts.map(a => `${a.key}:${a.severity}:${a.message}`).sort().join("|")]);
  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(records)); } catch { /* storage unavailable */ }
  }, [storageKey, loadedStorageKey, records]);
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
  useEffect(() => {
    const apply = () => {
      const marks = readNotificationMarks();
      setRecords(previous => previous.map(r => !r.resolvedAt && !r.acknowledgedAt && marks[`${nodeId}:${r.key}`] === r.severity
        ? {...r, acknowledgedAt: new Date().toISOString()} : r));
    };
    const onAck = (event: Event) => {
      const detail = (event as CustomEvent<Acknowledgement>).detail;
      if (detail?.nodeId === nodeId) setRecords(previous=>previous.map(r=>!r.resolvedAt && r.key===detail.key && r.severity===detail.severity
        ? {...r,acknowledgedAt:detail.at}:r));
    };
    const onStorage = (event: StorageEvent) => { if (event.key === acknowledgementKey) apply(); };
    apply(); window.addEventListener(acknowledgementEvent,onAck); window.addEventListener("storage",onStorage);
    return ()=>{window.removeEventListener(acknowledgementEvent,onAck);window.removeEventListener("storage",onStorage);};
  }, [nodeId, eventId, records.map(r=>`${r.key}:${r.severity}:${r.firstSeen}`).join("|")]);
  const displayed = showResolved ? records : active;
  function acknowledge(key: string, firstSeen: string) {
    const record = records.find(r=>r.key===key && r.firstSeen===firstSeen && !r.resolvedAt);
    if (!record) return;
    const stamp = publishAcknowledgement(nodeId, key, record.severity).at;
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

