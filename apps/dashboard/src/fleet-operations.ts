/** Pure fleet summary. An unreachable node is unknown, not a stopped recording. */
export type FleetNode = { id: string; name: string; online: boolean; local: boolean };
export type FleetRow = { cameraId: string; ring: string; cameraName: string; severity: 'critical' | 'warning' | 'ok'; capture: string; recording: string; relay: string; pendingRecovery: boolean; issues: string[] };
export type FleetSnapshot = { checkedAt: string; counts: { assigned: number; critical: number; warning: number; ok: number }; rows: FleetRow[]; youtubeVerified: false };
export type FleetObservation = { node: FleetNode; snapshot: FleetSnapshot | null; error: string | null; receivedAt: number };
export type FleetSummary = { nodes: number; online: number; reachable: number; assigned: number; critical: number; warning: number; ok: number; unknownNodes: number; pendingRetries: number };
export function summarizeFleetOperations(observations: FleetObservation[]): FleetSummary {
  const summary: FleetSummary = { nodes: observations.length, online: 0, reachable: 0, assigned: 0, critical: 0, warning: 0, ok: 0, unknownNodes: 0, pendingRetries: 0 };
  for (const observation of observations) {
    if (observation.node.online) summary.online++;
    if (!observation.node.online || !observation.snapshot || observation.error || !Number.isFinite(Date.parse(observation.snapshot.checkedAt)) || Date.now() - Date.parse(observation.snapshot.checkedAt) > 60_000) {
      summary.unknownNodes++; continue;
    }
    summary.reachable++;
    for (const row of observation.snapshot.rows) {
      summary.assigned++;
      if (row.severity === 'critical') summary.critical++;
      else if (row.severity === 'warning') summary.warning++;
      else summary.ok++;
      if (row.pendingRecovery) summary.pendingRetries++;
    }
  }
  return summary;
}
