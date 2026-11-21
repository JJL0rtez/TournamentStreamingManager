import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeFleetOperations } from '../apps/dashboard/src/fleet-operations.ts';

const sample = (id: string, online: boolean, rows: Array<{ severity: 'critical'|'warning'|'ok'; pendingRecovery: boolean }> = []) => ({
  node: { id, name: id, online, local: false },
  receivedAt: Date.now(), error: null,
  snapshot: online ? { checkedAt: new Date().toISOString(), youtubeVerified: false as const,
    counts: { assigned: rows.length, critical: 0, warning: 0, ok: 0 },
    rows: rows.map((r, i) => ({ cameraId: String(i), ring: '1', cameraName: 'cam', capture: 'running', recording: 'running', relay: 'none', issues: [], ...r }))
  } : null
});
test('fleet report aggregates assigned cameras across reachable nodes', () => {
  const state = summarizeFleetOperations([sample('a', true, [{severity:'ok',pendingRecovery:false},{severity:'warning',pendingRecovery:true}]), sample('b', true, [{severity:'critical',pendingRecovery:false}])]);
  assert.equal(state.reachable, 2); assert.equal(state.assigned, 3); assert.equal(state.pendingRetries, 1);
  assert.equal(state.critical, 1); assert.equal(state.warning, 1); assert.equal(state.ok, 1);
});
test('offline and failing nodes are unknown rather than healthy', () => {
  const state = summarizeFleetOperations([sample('offline', false), {...sample('fail',true), error:'timeout'}]);
  assert.equal(state.unknownNodes, 2); assert.equal(state.reachable, 0);
  assert.equal(state.assigned, 0);
});
test('stale snapshots cannot be counted as live', () => {
  const observation = sample('stale',true,[{severity:'ok',pendingRecovery:false}]);
  if (observation.snapshot) observation.snapshot.checkedAt = new Date(Date.now()-120_000).toISOString();
  const summary = summarizeFleetOperations([observation]);
  assert.equal(summary.unknownNodes,1); assert.equal(summary.ok,0);
});
test('remote proxy allows only GET of live readiness', () => {
  const source = readFileSync(new URL('../apps/node-service/src/remote-nodes.ts', import.meta.url), 'utf8');
  assert.match(source,/\^\\\/api\\\/operations\\\/live-readiness\$/);
  assert.match(source,/targetPath === "\/api\/operations\/live-readiness"/);
  assert.match(source,/readOnly && req\.method !== "GET"/);
});
