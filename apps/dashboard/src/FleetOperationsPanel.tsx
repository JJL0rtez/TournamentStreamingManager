import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from 'react';
import { summarizeFleetOperations, type FleetNode, type FleetObservation, type FleetSnapshot } from './fleet-operations';

type Request = (route: string) => Promise<any>;
/** Observe every configured node via the primary node's bounded read-only proxy. */
export function FleetOperationsPanel({ nodes, request }: { nodes: FleetNode[]; request: Request }) {
  const [observations, setObservations] = useState<FleetObservation[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await Promise.all(nodes.map(async (node: FleetNode): Promise<FleetObservation> => {
        const receivedAt = Date.now();
        if (!node.online) return { node, snapshot: null, error: 'Node unreachable; operating state unknown', receivedAt };
        try {
          const route = node.local ? '/api/operations/live-readiness' : `/api/nodes/${encodeURIComponent(node.id)}/operations/live-readiness`;
          const snapshot: FleetSnapshot = await request(route);
          if (!snapshot || !Array.isArray(snapshot.rows) || !snapshot.counts || typeof snapshot.checkedAt !== 'string') throw new Error('Malformed readiness response');
          if (snapshot.youtubeVerified !== false) throw new Error('Unsupported YouTube verification claim');
          return { node, snapshot, error: null, receivedAt };
        } catch (error) { return { node, snapshot: null, error: error instanceof Error ? error.message : String(error), receivedAt }; }
      }));
      setObservations(next);
    } finally { setBusy(false); }
  }, [nodes, request]);
  useEffect(() => {
    let active = true;
    const poll = async () => { if (active && !document.hidden) await refresh(); };
    const timer = startPolling(poll, 15_000);
    return () => { active = false; timer(); };
  }, [refresh]);
  const summary = summarizeFleetOperations(observations);
  const exportCsv = () => {
    const cells = (values: unknown[]) => values.map(value => {
      const raw = String(value ?? '');
      const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(',');
    const lines = [cells(['Node', 'Node ID', 'Checked at', 'Ring', 'Camera ID', 'Camera', 'Severity', 'Capture', 'Recording', 'Relay local', 'Recovery pending', 'Issues'])];
    for (const item of observations) {
      if (!item.snapshot || item.error) { lines.push(cells([item.node.name, item.node.id, '', '', '', '', 'unknown', '', '', '', '', item.error || 'No data'])); continue; }
      for (const row of item.snapshot.rows) lines.push(cells([item.node.name, item.node.id, item.snapshot.checkedAt, row.ring, row.cameraId, row.cameraName, row.severity, row.capture, row.recording, row.relay, row.pendingRecovery, row.issues.join('; ')]));
    }
    const blob = new Blob(['\uFEFF', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `tournament-fleet-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  return <details className="operator-tool-card" aria-label="Fleet-wide ring operations"><summary><strong>Fleet-wide ring operations</strong> (read-only)</summary>
    <p className="muted">Live ring conditions across configured PCs. Unknown or unreachable nodes are not counted as stopped cameras. Relay telemetry does not verify YouTube playback.</p>
    <p>{summary.reachable}/{summary.nodes} nodes reporting · {summary.assigned} assigned rings · {summary.critical} critical · {summary.warning} warnings · {summary.pendingRetries} pending retries · {summary.unknownNodes} unknown nodes</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing...' : 'Refresh fleet'}</button>{' '}
    <button type="button" disabled={!observations.length} onClick={exportCsv}>Export fleet CSV</button>{' '}
    <label>Filter <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All</option><option value="critical">Critical</option><option value="warning">Warnings</option></select></label>
    <div style={{overflowX: 'auto'}}><table><thead><tr><th>Node</th><th>Ring</th><th>Camera</th><th>Severity</th><th>Capture</th><th>Recording</th><th>Relay (local)</th><th>Issues</th></tr></thead><tbody>
    {observations.map(item => (!item.snapshot || item.error || Date.now() - Date.parse(item.snapshot.checkedAt) > 60_000)
      ? <tr key={item.node.id}><td>{item.node.name}</td><td colSpan={7} role="alert">Unknown: {item.error ?? 'Stale telemetry'}</td></tr>
      : item.snapshot.rows.filter(row => filter === 'all' || row.severity === filter).map(row => <tr key={`${item.node.id}:${row.cameraId}`}><td>{item.node.name}</td><td>{row.ring}</td><td>{row.cameraName}</td><td>{row.severity}</td><td>{row.capture}</td><td>{row.recording}</td><td>{row.relay}</td><td>{row.issues.join('; ') || 'No local issues detected'}</td></tr>))}
    </tbody></table></div>
  </details>;
}
