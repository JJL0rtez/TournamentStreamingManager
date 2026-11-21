import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const route = source.split('app.post("/api/session/start-all"')[1]?.split('app.post("/api/session/stop-all"')[0];
test('atomic mode is explicit opt-in, preserving legacy partial starts', () => {
  assert.ok(route);
  assert.match(route, /_req\.body\?\.atomicReservations === true/);
  assert.match(route, /if \(!atomicReservations\)/);
});
test('batch reservation happens before any capture start', () => {
  assert.ok(route.indexOf('reserveBatch(') < route.indexOf('cameraCaptureManager.start('));
  assert.match(route, /pendingAssignments\.find\(a => previewBusy\.has\(a\.cameraId\)\)/);
});
test('batch reservation always releases even if a capture throws', () => {
  assert.match(route, /finally \{\s*releaseBatch\?\.\(\);/);
  assert.match(route, /releaseStart\?\.\(\)/);
});
test('batch conflicts reject without starting any cameras', () => {
  assert.match(route, /res\.status\(409\)\.json\(\{ code: "CAPTURE_INPUT_BUSY"/);
  assert.match(route, /captureStartReservations\.reserveBatch/);
});
