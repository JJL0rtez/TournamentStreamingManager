import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
test('automatic distributed recovery requires independent explicit opt-in',()=>{
  assert.match(api,/TSM_DISTRIBUTED_AUTO_RECOVERY/);
  assert.match(api,/if \(!recoveryPolicy\.enabled \|\| \(distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn\)\) return;/);
});
test('distributed recovery rejects lost, uncertain, and busy ring ownership',()=>{
  assert.match(api,/matching\.length === 1 && matching\[0\]\.state === "active" && !matching\[0\]\.leaseLost/);
  assert.match(api,/!matching\[0\]\.stopInProgress && matching\[0\]\.pendingStarts === 0 && !matching\[0\]\.requiresReconciliation/);
});
test('eligibility and watchdog both enforce ownership readiness',()=>{
  assert.match(api,/if \(distributedCaptureLifecycle && !distributedRecoveryReady\(cameraId\)\)/);
  assert.match(api,/if \(distributedCaptureLifecycle && !distributedRecoveryReady\(item\.cameraId\)\) continue;/);
});
test('relay and rate limits remain in the watchdog',()=>{
  assert.match(api,/youtubeStreams\.list\(\)\.some\(stream => stream\.cameraId === item\.cameraId\)/);
  assert.match(api,/RECOVERY_MAX_PER_HOUR/);
  assert.match(api,/RECOVERY_COOLDOWN_MS/);
});
