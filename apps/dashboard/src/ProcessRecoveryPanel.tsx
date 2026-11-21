import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from "react";

type Retry = { cameraId: string; attempts: number; pending: boolean; enabled?: boolean; captureActive?: boolean; nextRetryAt?: string | null };
type Event = { cameraId: string; at: string; type: string; detail: string };
type Snapshot = { checkedAt: string; captures: { automaticEnabled: boolean; retries: Retry[]; events: Event[] }; relays: { automaticEnabled: boolean; retries: Retry[]; events: Event[] }; note: string };

/** Read-only diagnostics. This component never starts, restarts, or stops a camera. */
export function ProcessRecoveryPanel({ requestNode }: { requestNode: (url: string, options?: RequestInit) => Promise<any> }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result: Snapshot = await requestNode("/api/operations/process-recovery");
      setSnapshot(result); setError("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }, [requestNode]);
  useEffect(() => {
    let active = true;
    // The request function is owned by the parent and may change identity on renders.
    // Use this one for the polling lifecycle; stale responses are ignored at unmount.
    const poll = async () => {
      try { const result: Snapshot = await requestNode("/api/operations/process-recovery"); if (active) { setSnapshot(result); setError(""); } }
      catch (cause) { if (active) setError(String(cause)); }
    };
    const timer = startPolling(poll, 10_000);
    return () => { active = false; timer(); };
  }, []);
  return <section className="overview" aria-label="FFmpeg process recovery">
    <h3>Capture and YouTube process recovery</h3>
    <p className="muted">Local FFmpeg process recovery, not confirmation of YouTube ingest or public playback.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing..." : "Refresh recovery status"}</button>
    {error && <p role="alert">Recovery telemetry unavailable: {error}</p>}
    {snapshot && <>
      <p>Capture automatic retries: <strong>{snapshot.captures.automaticEnabled ? "Enabled" : "Disabled"}</strong>. Relay automatic retries: <strong>{snapshot.relays.automaticEnabled ? "Enabled" : "Disabled"}</strong>.</p>
      <small className="muted">Updated {new Date(snapshot.checkedAt).toLocaleTimeString()}</small>
      <h4>Capture retries</h4>
      {snapshot.captures.retries.length === 0 ? <p>No recorded capture retry attempts.</p> : <ul>{snapshot.captures.retries.map(item => <li key={item.cameraId}>{item.cameraId}: {item.attempts} attempts, {item.pending ? "retry scheduled" : "no retry pending"}</li>)}</ul>}
      <h4>Recent capture recovery events</h4>
      {snapshot.captures.events.length === 0 ? <p>No capture recovery events since service startup.</p> : <ul>{snapshot.captures.events.slice(0, 20).map((event, index) => <li key={`${event.at}-${event.cameraId}-${index}`}><strong>{event.cameraId}</strong> {event.type}: {event.detail} <small>({new Date(event.at).toLocaleTimeString()})</small></li>)}</ul>}
      <h4>Relay retries</h4>
      {snapshot.relays.retries.length === 0 ? <p>No recorded relay retry attempts.</p> : <ul>{snapshot.relays.retries.map(item => <li key={item.cameraId}>{item.cameraId}: {item.attempts} attempts, {item.pending ? `retry due ${item.nextRetryAt ? new Date(item.nextRetryAt).toLocaleTimeString() : "soon"}` : "no retry pending"}, capture {item.captureActive ? "active" : "inactive"}</li>)}</ul>}
      <h4>Recent relay recovery events</h4>
      {snapshot.relays.events.length === 0 ? <p>No relay recovery events since service startup.</p> : <ul>{snapshot.relays.events.slice(0, 20).map((event, index) => <li key={`${event.at}-${event.cameraId}-${index}`}><strong>{event.cameraId}</strong> {event.type}: {event.detail} <small>({new Date(event.at).toLocaleTimeString()})</small></li>)}</ul>}
    </>}
  </section>;
}
