import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../apps/node-service/src/api.ts', import.meta.url), 'utf8');
const wrapper = source.match(/const startYoutubeRelay = async \(cameraId: string, key: string\): Promise<void> => \{([\s\S]*?)\n\};/);
test('YouTube start wrapper is present and invokes the actual relay manager in local mode', () => {
  assert.ok(wrapper, 'startYoutubeRelay wrapper missing');
  assert.match(wrapper[1], /coordinatedYoutube\.start\(cameraId, key\)/);
  assert.match(wrapper[1], /youtubeStreams\.start\(cameraId, key\)/);
  assert.doesNotMatch(wrapper[1], /(?:else|await)\s+await startYoutubeRelay\(/);
});
test('YouTube route starts use the shared wrapper', () => {
  assert.match(source, /app\.post\("\/api\/youtube\/:cameraId\/start"[\s\S]*?await startYoutubeRelay\(cameraId, effectiveKey\)/);
  assert.match(source, /app\.post\("\/api\/youtube\/start-all"[\s\S]*?await startYoutubeRelay\(cameraId, key\)/);
});
test('YouTube relay coordination remains opt-in', () => {
  assert.match(source, /process\.env\.TSM_COORDINATE_YOUTUBE === "1"/);
});
