import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const guard = readFileSync(new URL('../apps/node-service/src/capture-path-guard.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
test('both competing paths are protected', () => {
  assert.match(guard, /LEGACY_RECORDING_ALREADY_ACTIVE/);
  assert.match(guard, /SHARED_CAPTURE_ALREADY_ACTIVE/);
  assert.match(api, /competingCapturePath\("shared"/);
  assert.match(api, /competingCapturePath\("legacy-recording"/);
});
test('conflicts return 409 before manager starts', () => {
  const shared = api.indexOf('app.post("/api/captures/start"');
  const legacy = api.indexOf('app.post("/api/recordings/start"');
  assert.ok(api.indexOf('competingLegacy', shared) < api.indexOf('cameraCaptureManager.start(', shared));
  assert.ok(api.indexOf('competingShared', legacy) < api.indexOf('recordingManager.start(', legacy));
});
