import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UnifiedRingLifecycle } from '../packages/capture-coordination/unified-lifecycle.mjs';
const api = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
test('distributed start retains the same requested capture mode as local start', () => {
  assert.match(api, /distributedCaptureLifecycle\.start\("capture", cameraId,[\s\S]*?requestedCaptureMode\s*\)\) : cameraCaptureManager\.start/);
});
test('session root and YouTube relay mutations are included in the distributed fail-closed gate', () => {
  assert.match(api, /\(\?:\\\/\|\$\)/);
  assert.match(api, /youtubeRelayMutation/);
  assert.match(api, /start-all\|stop-all/);
});
test('untracked capture stop is rejected before any YouTube relay stop', () => {
  const start = api.indexOf('app.post("/api/captures/:cameraId/stop"');
  const stop = api.indexOf('app.post("/api/capture/test/start"', start);
  const route = api.slice(start,stop);
  assert.ok(route.indexOf('distributedCaptureLifecycle.hasMember') < route.indexOf('await stopYoutubeRelay(cameraId)'));
});
test('lifecycle membership query is read-only and returns false for untracked cameras', () => {
  const lifecycle = new UnifiedRingLifecycle({client:{},identityFor:()=>({})});
  assert.equal(lifecycle.hasMember('capture','missing'),false);
  assert.equal(lifecycle.rings.size,0);
});
