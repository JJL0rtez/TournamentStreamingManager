import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const paths = ['/api/captures/start', '/api/captures/:cameraId/stop', '/api/captures/:cameraId/recover', '/api/recordings/start', '/api/recordings/:cameraId/stop'];
for (const path of paths) {
  test(`${path} blocks manual lifecycle changes during tournament operation`, () => {
    const begin = src.indexOf(`app.post("${path}"`);
    assert.ok(begin >= 0);
    const segment = src.slice(begin, begin + 280);
    assert.match(segment, /if \(rejectDuringSessionOperation\(res\)\) return;/);
  });
}
test('manual mutation gate reports conflict and operation name', () => {
  assert.match(src, /function rejectDuringSessionOperation\(/);
  const section = src.split('function rejectDuringSessionOperation(')[1].split('app.get("/api/session/operation"')[0];
  assert.match(section, /status\(409\)/);
  assert.match(section, /SESSION_OPERATION_BUSY/);
  assert.match(section, /activeOperation: activeSessionOperation/);
});
test('capture stop-all participates in tournament-wide lock and releases on failure', () => {
  const section = src.split('app.post("/api/captures/stop-all"')[1].split('app.post("/api/captures/:cameraId/stop"')[0];
  assert.match(section, /beginSessionOperation\("stop-all"\)/);
  assert.match(section, /finally \{ finishOperation\(\); \}/);
});
