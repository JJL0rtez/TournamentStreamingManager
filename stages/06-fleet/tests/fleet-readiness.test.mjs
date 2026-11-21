import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFleet,safeNodeId,selectNodeStatus } from "../apps/node-service/src/fleet-readiness.ts";
test("aggregates independent node status and outage warnings",()=>{
 const report=summarizeFleet([
  {id:"main",name:"Main",local:true,online:true,checkedAt:"x",latencyMs:0,health:{},storage:null,captures:null,entitlement:null,errors:[]},
  {id:"secondary",name:"Second",local:false,online:false,checkedAt:"x",latencyMs:null,health:null,storage:null,captures:null,entitlement:null,errors:["Timed out"]}
 ]);
 assert.equal(report.summary.total,2);assert.equal(report.summary.online,1);
 assert.equal(report.summary.offline,1);assert.equal(report.summary.nodesWithWarnings,1);
 assert.match(report.warnings.join(" "),/capture may still be running independently/);
});
test("rejects invalid node identifiers",()=>{
 assert.equal(safeNodeId("main_pc-2"),true);
 assert.equal(safeNodeId("../localhost"),false);
 assert.equal(safeNodeId(""),false);
});
test("rejects invalid response envelopes",()=>{
 assert.equal(selectNodeStatus(null),null);
 assert.equal(selectNodeStatus([]),null);
 assert.deepEqual(selectNodeStatus({healthy:true}),{healthy:true});
});
test("flags duplicate node ids",()=>{
 const n={id:"same",name:"One",local:false,online:true,checkedAt:"x",latencyMs:1,health:{},storage:null,captures:null,entitlement:null,errors:[]};
 assert.match(summarizeFleet([n,{...n,name:"Two"}]).warnings.join(" "),/Duplicate node ID/);
});
