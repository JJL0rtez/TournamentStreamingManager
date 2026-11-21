import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureRecoveryPlanner } from '../apps/node-service/src/capture-recovery-planner.ts';
import { readFileSync } from 'node:fs';

const manager = readFileSync(new URL('../apps/node-service/src/camera-capture-manager.ts', import.meta.url), 'utf8');

test('capture retry policy caps attempts and applies exponential delay', () => {
  const planner = new CaptureRecoveryPlanner();
  assert.deepEqual([0,1,2,3].map(i => planner.nextDelay('camA', i*1000)), [2000,4000,8000,null]);
  assert.equal(planner.nextDelay('camB', 4000), 2000);
});
test('capture retry window expires and resets', () => {
  const planner = new CaptureRecoveryPlanner();
  assert.equal(planner.nextDelay('camA', 100), 2000);
  assert.equal(planner.nextDelay('camA', 10*60_000 + 100), 2000);
});
test('capture retry cancellation clears only selected camera', () => {
  const planner = new CaptureRecoveryPlanner();
  planner.nextDelay('camA', 0);
  planner.nextDelay('camB', 0);
  planner.clear('camA');
  assert.deepEqual(planner.snapshot(), [{cameraId:'camB',attempts:1}]);
  planner.clearAll();
  assert.deepEqual(planner.snapshot(), []);
});
test('manual start invalidates queued retry; retry uses distinct code path', () => {
  assert.match(manager, /if \(!recoveryAttempt && !this\.captures\.has\(cameraId\)/);
  assert.match(manager, /this\.cancelRecovery\(cameraId\);\s*this\.recovery\.clear\(cameraId\)/);
  assert.match(manager, /managed\.outputMode, true\)/);
});
test('recovery cannot stop a separately replaced camera', () => {
  assert.match(manager, /if \(current\?\.capture === restarted\.capture\) await this\.stop/);
});
