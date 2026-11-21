import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const app = read('apps/dashboard/src/App.tsx');
const css = read('apps/dashboard/src/App.css');
const hardware = read('apps/dashboard/src/HardwareReadinessPanel.tsx');

test('primary buttons use blue, not purple', () => {
  assert.match(css, /button\.primary-button\s*\{[^}]*background:\s*#1d4ed8/);
  assert.doesNotMatch(css, /#6846a5|#9064cf|#7956b9/);
});
test('camera cards appear before operator diagnostics', () => {
  assert.ok(app.indexOf('<h2>Cameras</h2>') > app.indexOf('<h3>Tournament session</h3>'));
  assert.ok(app.indexOf('<h2>Cameras</h2>') < app.indexOf('aria-label="Live Health"'));
  assert.ok(app.indexOf('<h2>Cameras</h2>') < app.indexOf('aria-label="Advanced tools and reports"'));
});
test('incident replay is not mounted on the production dashboard', () => {
  assert.doesNotMatch(app, /<IncidentReplayPanel/);
});
test('record control is independent of stream keys', () => {
  const match = app.match(/<button type="button" className=\{capture\?\.recordingEnabled[^]*?onClick=\{\(\) => void toggleRecording\(camera, capture\)\}>([^]*?)<\/button>/);
  assert.ok(match, 'Record control should use the recording state');
  assert.doesNotMatch(match[0], /streamKeys|savedProfiles/);
  assert.match(match[0], /"Record"/);
  assert.match(app, /YouTube stream key/);
});
test('settings and tools are behind collapsed advanced menus', () => {
  assert.match(app, /<details className="operator-advanced-shell operator-settings-shell"/);
  assert.match(app, /<details className="operator-advanced-shell" aria-label="Advanced tools and reports"/);
  assert.ok(app.indexOf('<HardwareReadinessPanel') > app.indexOf('aria-label="Advanced settings"'));
});
test('hardware readiness separates recording drive and USB port cards', () => {
  assert.match(hardware, /hardware-readiness-grid/);
  assert.match(hardware, /<h4>Recording drive<\/h4>/);
  assert.match(hardware, /<h4>USB port topology<\/h4>/);
});
test('session display names preserve whitespace while file slugs remain safe', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tournament-session-v13-'));
  const previous = process.env.TOURNAMENT_CONFIG_DIR;
  try {
    process.env.TOURNAMENT_CONFIG_DIR = dir;
    const file = new URL('apps/node-service/src/tournament-session.ts', root);
    const session = await import(pathToFileURL(file.pathname).href + '?v13');
    const saved = session.setSession({ eventName: 'Fall Championship 2027', assignments: [
      { cameraId: 'cam1', cameraName: 'Camera One', microphoneName: 'Mic One', ring: 'Ring 1' }
    ] });
    assert.equal(saved.eventName, 'Fall Championship 2027');
    assert.equal(saved.assignments[0].ring, 'Ring 1');
    assert.equal(session.safeRecordingName('Fall Championship 2027'), 'Fall_Championship_2027');
  } finally {
    if (previous === undefined) delete process.env.TOURNAMENT_CONFIG_DIR;
    else process.env.TOURNAMENT_CONFIG_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
