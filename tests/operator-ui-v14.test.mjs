import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = name => readFileSync(path.join(root,name), 'utf8');
const app = source('apps/dashboard/src/App.tsx');
const api = source('apps/node-service/src/api.ts');
const hardware = source('apps/dashboard/src/HardwareReadinessPanel.tsx');
const snapshot = source('apps/node-service/src/live-operations-snapshot.ts');

test('basic camera controls contain no recording-mode selector and say Record', () => {
  assert.doesNotMatch(app, /<span>Camera label<\/span>|Recording mode\{" "\}|Production \(clean\)/);
  assert.match(app, /"Stop Recording" : "Record"/);
  assert.doesNotMatch(app, /Recording works without a YouTube stream key/);
  assert.match(app, /session\.assignments\.find\(item => item\.cameraId === cameraId\)\?\.ring/);
});
test('saved key has a disabled Saved button with Forget key beside it', () => {
  assert.match(app, /Boolean\(savedProfiles\[camera\.id\]\)/);
  assert.match(app, /savedProfiles\[camera\.id\] \? "Saved" : "Save key"/);
  assert.match(app, /Forget key/);
  assert.doesNotMatch(app, /Saved: \{savedProfiles/);
  assert.doesNotMatch(app, /Bulk YouTube key setup/);
});
test('no per-ring pre-tournament checklist is mounted', () => {
  assert.doesNotMatch(app, /<RingPreTournamentSignoff/);
});
test('stream-only startup explicitly disables disk recording and recording-only needs no key', () => {
  assert.match(app, /recordingEnabled: false/);
  assert.match(app, /recordingEnabled: true, mode: "production"/);
  assert.match(api, /const recordingEnabled = req\.body\?\.recordingEnabled !== false/);
  assert.match(api, /if \(recordingEnabled\) await assertRecordingSpace\(\)/);
  assert.match(api, /recordingDirectory\(outputDirectory, cameraId\), recordingEnabled, requestedCaptureMode/);
  assert.match(app, /startedStreamOnly/);
  assert.match(app, /for \(const cameraId of new Set\(cameraIds\)\)/);
  assert.doesNotMatch(app, /activeRecordings\.length === 0\}\s+onClick=\{\(\) => void bulkYouTube\(\"start-all\"\)/);
});
test('stream-only capture cannot be mistakenly reported as recording', () => {
  assert.match(app, /capture\.recordingEnabled === false \? \(youtube \? "Streaming"/);
  assert.match(app, /capture && capture\.recordingEnabled !== false && \(/);
  assert.match(snapshot, /!capture\.recordingEnabled && !relay/);
});
test('recording destination change is persistent and blocked while cameras run', () => {
  assert.match(api, /app\.put\("\/api\/storage\/location"/);
  assert.match(api, /cameraCaptureManager\.list\(\)\.length/);
  assert.match(api, /persistRecordingDestination\(recordingLocationFile, directory\)/);
  assert.match(hardware, /Browse folders/);
  assert.match(hardware, /Save location/);
  assert.match(hardware, /Choose drive/);
});
test('recording destination module persists selected folder, supports listing', async () => {
  const m = await import('../apps/node-service/src/recording-directory-config.ts');
  const dir = mkdtempSync(path.join(tmpdir(), 'tsm-v14-'));
  try {
    const selected = path.join(dir, 'recordings');
    assert.equal(await m.validateRecordingDestination(selected), selected);
    const config = path.join(dir, 'config.json');
    m.persistRecordingDestination(config, selected);
    assert.equal(m.loadRecordingDestination(config, dir), selected);
    assert.ok((await m.listRecordingDirectories(dir)).folders.includes('recordings'));
    await assert.rejects(m.validateRecordingDestination('relative/path'));
    await assert.rejects(m.listRecordingDirectories('relative/path'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
