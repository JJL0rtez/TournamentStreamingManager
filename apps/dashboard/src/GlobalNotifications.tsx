import { useEffect, useMemo, useState } from "react";
import "./GlobalNotifications.css";
import { acknowledgementKey, acknowledgementEvent, readNotificationMarks, publishAcknowledgement, type Acknowledgement } from "./notification-ack";
import { summarizeNotifications, pruneNotificationMarks } from "./notification-state";

export type GlobalAlert = { key: string; severity: "critical" | "warning"; message: string };
type NodeAlerts = { nodeId: string; nodeName: string; alerts: GlobalAlert[]; online: boolean; complete?: boolean };
type Item = GlobalAlert & { nodeId: string; nodeName: string; id: string };
export function GlobalNotifications() {
  const [nodes, setNodes] = useState<Record<string, NodeAlerts>>({});
  const [ack, setAck] = useState<Record<string, string>>(readNotificationMarks);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<Record<string, string>>({});
  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<NodeAlerts>).detail;
      if (!detail || typeof detail.nodeId !== "string" || !Array.isArray(detail.alerts)) return;
      setNodes(previous => ({ ...previous, [detail.nodeId]: detail }));
    };
    window.addEventListener("tournament:operations-alerts", onUpdate);
    return () => window.removeEventListener("tournament:operations-alerts", onUpdate);
  }, []);
  useEffect(() => {
    const onAck=(event:Event)=>{const mark=(event as CustomEvent<Acknowledgement>).detail;
      if(mark) setAck(previous=>({...previous,[`${mark.nodeId}:${mark.key}`]:mark.severity}));};
    const onStorage=(event:StorageEvent)=>{if(event.key===acknowledgementKey) setAck(readNotificationMarks());};
    window.addEventListener(acknowledgementEvent,onAck);window.addEventListener("storage",onStorage);
    return ()=>{window.removeEventListener(acknowledgementEvent,onAck);window.removeEventListener("storage",onStorage);};
  },[]);
  const alerts = useMemo(() => Object.values(nodes).flatMap(node => node.alerts.map(alert => ({ ...alert, nodeId: node.nodeId, nodeName: node.nodeName, id: `${node.nodeId}:${alert.key}` })))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical")), [nodes]);
  // Acknowledge the active incident by key and severity, not its changing metric text.
  // When an incident clears, discard its acknowledgement so a recurrence is new.
  useEffect(() => {
    const known = Object.values(nodes).filter(node=>node.online && node.complete === true).map(node=>node.nodeId);
    const prune = (previous: Record<string, string>) => pruneNotificationMarks(previous, alerts, known);
    setAck(prune); setHidden(prune);
  }, [alerts, nodes]);
  useEffect(() => { try { localStorage.setItem(acknowledgementKey, JSON.stringify(ack)); } catch { /* optional */ } }, [ack]);
  const { unacknowledged, critical, top } = summarizeNotifications(alerts, ack, hidden);
  function acknowledge(item: Item) {
    publishAcknowledgement(item.nodeId, item.key, item.severity);
    setAck(previous => ({ ...previous, [item.id]: item.severity }));
  }
  return <div className="global-notifications" aria-label="Global streaming notifications">
    <div className="global-notification-toolbar">
      <button type="button" className="global-notification-bell" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={`Notifications: ${alerts.length} active, ${unacknowledged.length} new`}>
        Notifications ({alerts.length})
      </button>
      {alerts.length > 0 && <span className="global-notification-counts">{critical.length} critical · {unacknowledged.length} new</span>}
    </div>
    {top && <div className={`global-notification-banner ${top.severity}`} role="alert">
      <strong>{top.severity === "critical" ? "CRITICAL" : "WARNING"} · {top.nodeName}</strong>
      <span>{top.message}</span>
      <button type="button" onClick={() => { setExpanded(true); document.getElementById("global-notification-list")?.scrollIntoView({ block: "nearest" }); }}>Details</button>
      <button type="button" onClick={() => acknowledge(top)}>Acknowledge</button>
      <button type="button" onClick={() => setHidden(previous => ({ ...previous, [top.id]: top.severity }))} aria-label="Hide this banner (alert remains active)">×</button>
    </div>}
    {expanded && <div id="global-notification-list" className="global-notification-list" role="region" aria-label="Active streaming alerts">
      <div className="global-notification-list-heading"><strong>Active streaming alerts</strong><button type="button" onClick={() => setExpanded(false)}>Close</button></div>
      {alerts.length === 0 ? <p>No active alerts.</p> : alerts.map(item => <div key={item.id} className={`global-notification-item ${item.severity}`}>
        <div><strong>{item.nodeName} · {item.severity}</strong><p>{item.message}</p><small>{ack[item.id] === item.severity ? "Acknowledged, still active" : "Needs acknowledgement"}</small></div>
        <button type="button" disabled={ack[item.id] === item.severity} onClick={() => acknowledge(item)}>Acknowledge</button>
      </div>)}
      <p className="global-notification-note">Acknowledging does not resolve a failure. Alerts disappear only when the underlying condition clears.</p>
    </div>}
  </div>;
}
