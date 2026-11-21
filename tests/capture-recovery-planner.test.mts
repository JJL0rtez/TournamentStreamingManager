import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptureRecoveryPlanner } from "../apps/node-service/src/capture-recovery-planner.ts";

test("exponential backoff and bounded retry budget", () => {
  const planner = new CaptureRecoveryPlanner(3, 600000, 2000, 30000);
  assert.equal(planner.nextDelay("ring1", 1000), 2000);
  assert.equal(planner.nextDelay("ring1", 2000), 4000);
  assert.equal(planner.nextDelay("ring1", 3000), 8000);
  assert.equal(planner.nextDelay("ring1", 4000), null);
  assert.equal(planner.nextDelay("ring2", 4000), 2000);
  assert.equal(planner.nextDelay("ring1", 700001), 2000);
  planner.clear("ring1");
  assert.equal(planner.nextDelay("ring1", 700002), 2000);
});
