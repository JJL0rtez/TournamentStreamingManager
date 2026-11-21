import { test } from "node:test";
import { strict as assert } from "node:assert";
import { makeCapacityReport, evaluateAssignmentIssues } from "../apps/node-service/src/capacity-readiness.ts";
const assignments = Array.from({ length: 12 }, (_, i) => ({cameraId:`camera-${i}`,ring:`Ring ${i+1}`,microphoneName:`Mic ${i+1}`}));
test("12 rings are configurable without an artificial eight-ring limit", () => {
 const report = makeCapacityReport(assignments);
 assert.equal(report.configuredAssignments,12);
 assert.equal(report.verifiedSimultaneousStreams,null);
 assert.equal(report.status,"unverified");
 assert.equal(report.issues.length,0);
});
test("duplicate cameras and rings are reported", () => {
 const issues=evaluateAssignmentIssues([...assignments,{...assignments[0]}]);
 assert(issues.some(x=>x.code==="duplicate-camera"));
 assert(issues.some(x=>x.code==="duplicate-ring"));
 assert(issues.some(x=>x.code==="shared-microphone"));
});
test("empty configuration is unverified rather than passed",()=>{
 const report=makeCapacityReport([]);
 assert.equal(report.status,"unverified");
 assert.equal(report.configuredAssignments,0);
});
