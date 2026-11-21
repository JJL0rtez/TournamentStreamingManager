import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
test('distributed mode is explicit opt in and off by default',()=>{assert.match(api,/TSM_DISTRIBUTED_CAPTURE === "1"/);assert.match(api,/distributedCaptureEnabled\s*\? createUnifiedLifecycle/);});
test('shared capture starts under a ring lease in distributed mode',()=>{assert.match(api,/distributedCaptureLifecycle\.start\("capture", cameraId, \(\) => cameraCaptureManager\.start/);});
test('shared capture stops under the matching lease',()=>{assert.match(api,/distributedCaptureLifecycle\.stop\("capture", cameraId, \(\) => cameraCaptureManager\.stop\(cameraId\)\)/);});
test('bulk and legacy mutation paths are denied when enabled',()=>{assert.match(api,/DISTRIBUTED_CAPTURE_UNSUPPORTED_OPERATION/);assert.match(api,/captures\|recordings\|session\|capture\|recovery/);});
test('status endpoint exposes ownership without credentials',()=>{assert.match(api,/"\/api\/captures\/distributed-ownership"/);assert.match(api,/distributedCaptureLifecycle\?\.status\(\)/);});
