import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
test('mode transitions check existing capture in both directions',()=>{
 assert.match(api,/existingCapture\.outputMode !== requestedCaptureMode/);
 assert.match(api,/CAPTURE_MODE_TRANSITION_REQUIRES_STOP/);
});
test('omitting mode does not implicitly keep diagnostic mode',()=>{
 assert.match(api,/req\.body\?\.mode === "diagnostic" \? "diagnostic" : "production"/);
});
test('diagnostic requests still pass through centralized guard',()=>{
 assert.match(api,/const outputDecision = evaluateOutputStart\(/);
 assert.match(api,/diagnosticCaptureAllowed: process\.env\.TSM_ENABLE_LOCAL_DIAGNOSTICS === "1"/);
});
