import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const stop = api.slice(api.indexOf('app.post("/api/captures/:cameraId/stop"'), api.indexOf('app.post("/api/capture/test/start"'));
test('distributed stop cannot mutate YouTube relays',()=>{
  assert.match(stop, /if \(distributedCaptureLifecycle\) \{[\s\S]*?distributedCaptureLifecycle\.stop\("capture"/);
  assert.match(stop, /else \{\s*await stopYoutubeRelay\(cameraId\)/);
});
test('untracked capture is rejected before distributed stop',()=>{
  assert.ok(stop.indexOf('distributedCaptureLifecycle.hasMember') < stop.indexOf('distributedCaptureLifecycle.stop("capture"'));
});
test('reconciliation endpoint is read only and shows missing and orphaned captures',()=>{
  const part=api.slice(api.indexOf('app.get("/api/captures/distributed-reconciliation"'),api.indexOf('installRemoteNodeRoutes(app)'));
  assert.match(part,/untrackedRunning/);assert.match(part,/trackedNotRunning/);assert.match(part,/uncertainRings/);
  assert.doesNotMatch(part,/\.start\(|\.stop\(|\.release\(|\.acquire\(/);
});
test('reconciliation output disables safeToEnable when ring state uncertain',()=>{
  assert.match(api,/uncertainRings\.length===0/);
});
