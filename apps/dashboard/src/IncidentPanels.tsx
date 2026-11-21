import { startPolling } from "./operator-polling";
import { OperationsAlertHistory, type OperationsAlertInput, type OperationsAlertSeverity, type OperationsAlertRecord } from "./OperationsAlertHistory";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type IncidentEntry } from "./dashboard-shared";

export function IncidentAnalytics({ nodeId, eventId }: { nodeId: string; eventId: string }) {
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
    const interval = startPolling(refresh, 3000);
    return () => interval();
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

export function IncidentTrends({ nodeId, eventId }: { nodeId: string; eventId: string }) {
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
    const timer = startPolling(refresh, 3000);
    return () => timer();
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

export function IncidentHeatmap({ nodeId, eventId }: { nodeId: string; eventId: string }) {
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
    const timer = startPolling(refresh, 3000);
    return () => timer();
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

export function IncidentLog({ nodeId, eventId, alerts, online }: {
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

export interface IncidentTimelineEvent {
  id: string;
  at: string;
  type: string;
  detail: string;
  source: "Alert" | "Incident";
  severity?: string;
}

export function IncidentTimeline({ nodeId, eventId }: { nodeId: string; eventId: string }) {
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
    const timer = startPolling(refresh, 3000);
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => { timer(); window.removeEventListener("storage", onStorage); };
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
