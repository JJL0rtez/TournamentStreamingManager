import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const bulk = api.split('app.post("/api/session/start-all"')[1]?.split('app.post("/api/session/stop-all"')[0];
test('bulk route resolves hardware identity and reserves before starting processes', () => {
  assert.ok(bulk);
  assert.match(bulk, /reserveCaptureStart\("shared"/);
  assert.ok(bulk.indexOf('await resolveMicrophone') < bulk.indexOf('reserveCaptureStart("shared"'));
  assert.match(bulk,/microphoneName: mic\.input/);
  assert.ok(bulk.indexOf('reserveCaptureStart("shared"') < bulk.indexOf('await previewProcessManager.stop'));
  assert.ok(bulk.indexOf('reserveCaptureStart("shared"') < bulk.indexOf('await cameraCaptureManager.start'));
});
test('bulk route reports per-camera conflicts without aborting already started cameras', () => {
  assert.match(bulk, /catch \(error\) \{\s*results\.push\(\{ cameraId, ok: false/);
  assert.match(bulk, /continue;\s*}\s*}\s*previewBusy\.add/);
  assert.doesNotMatch(bulk.split("for (const assignment of session.assignments)")[1], /res\.status\(409\)/);
});
test('bulk route releases reservation and busy flag in finally', () => {
  assert.match(bulk, /finally \{\s*previewBusy\.delete\(cameraId\);\s*releaseStart\?\.\(\);/);
});
test('bulk route preserves per-camera outcome response', () => {
  assert.match(bulk, /res\.status\(results\.some\(\(item\) => !item\.ok\) \? 207 : 200\)\.json\(\{ results, atomicReservations \}\)/);
});
