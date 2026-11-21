import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
test('distributed mode blocks recovery before process stop',()=>{
 const eligibility=src.split('function recoveryEligibility(')[1].split('async function recoverCapture(')[0];
 assert.ok(eligibility.indexOf('if (distributedCaptureLifecycle) return') < eligibility.indexOf('reserveCaptureRecovery(cameraId)'));
 const mutation=src.split('async function recoverCapture(')[1].split('app.get("/api/captures/recovery-policy"')[0];
 assert.ok(mutation.indexOf('if (distributedCaptureLifecycle) throw') < mutation.indexOf('cameraCaptureManager.stop(cameraId)'));
});
test('watchdog requires separate distributed recovery opt-in',()=>assert.match(src,/if \(!recoveryPolicy\.enabled \|\| \(distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn\)\) return;/));
test('policy rejects enabling unsupported distributed recovery',()=>{
 const route=src.split('app.put("/api/captures/recovery-policy"')[1].split('app.get("/api/captures/recovery-status"')[0];
 assert.ok(route.indexOf('distributedCaptureLifecycle && body.enabled') < route.indexOf('saveRecoveryPolicy(next)'));
});
test('status reports effective recovery setting',()=>{
 assert.match(src,/effectiveEnabled: recoveryPolicy\.enabled && \(!distributedCaptureLifecycle \|\| distributedAutomaticRecoveryOptIn\)/);
 assert.match(src,/automaticEnabled: recoveryPolicy\.enabled && \(!distributedCaptureLifecycle \|\| distributedAutomaticRecoveryOptIn\)/);
});
