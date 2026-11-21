import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api = fs.readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const installer = fs.readFileSync(new URL('../scripts/integration/apply-unified-capture.mjs', import.meta.url), 'utf8');
test('readiness route is registered once and is read only', () => {
  assert.equal(api.split('app.get("/api/captures/ownership-readiness"').length - 1, 1);
  const route = api.split('app.get("/api/captures/ownership-readiness"')[1].split('app.get("/api/youtube/coordination"')[0];
  assert.match(route, /unifiedOwnershipEnabled: false/);
  assert.doesNotMatch(route, /\.(?:start|stop|acquire|release)\s*\(/);
});
test('existing YouTube coordination is not replaced by another lease owner', () => {
  assert.match(api, /new CoordinatedYouTube\(youtubeStreams\)/);
  assert.match(api, /const startYoutubeRelay = async/);
});
test('legacy installer does not mutate API', () => {
  assert.doesNotMatch(installer, /writeFileSync|renameSync|copyFileSync/);
  assert.match(installer, /BATCH22_READINESS_ROUTE_MISSING/);
});
