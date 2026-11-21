import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
function route(method, path, end) {
  const start = src.indexOf(`app.${method}("${path}"`);
  assert.ok(start >= 0, `${path} route exists`);
  const finish = src.indexOf(end, start);
  assert.ok(finish > start, `${path} closing marker exists`);
  return src.slice(start, finish);
}
test('start-all acquires process-local operation lock before first await and releases in finally', () => {
  const code = route('post', '/api/session/start-all', 'app.post("/api/session/stop-all"');
  assert.match(code, /beginSessionOperation\("start-all"\)/);
  assert.match(code, /SESSION_OPERATION_BUSY/);
  assert.match(code, /finally \{ finishOperation\(\); \}/);
  assert.ok(code.indexOf('beginSessionOperation') < code.indexOf('evaluateOutputStart'));
});
test('stop-all serializes with start-all and always unlocks', () => {
  const code = route('post', '/api/session/stop-all', '// Server-side recording health.');
  assert.match(code, /beginSessionOperation\("stop-all"\)/);
  assert.match(code, /SESSION_OPERATION_BUSY/);
  assert.match(code, /finally \{ finishOperation\(\); \}/);
});
test('operation status endpoint is passive and explicitly process-local', () => {
  const code = route('get', '/api/session/operation', '// Each camera is started independently.');
  assert.match(code, /processLocal: true/);
  assert.match(code, /Cache-Control/);
});
test('interlock is idempotent and never queues stale operations', () => {
  assert.match(src, /if \(activeSessionOperation\) return null/);
  assert.match(src, /if \(!finished\) \{ finished = true; activeSessionOperation = null; \}/);
});
