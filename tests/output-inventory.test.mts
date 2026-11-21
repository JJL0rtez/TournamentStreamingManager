import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOutputInventory, assertNoUnverifiedDiagnosticRelays } from "../apps/node-service/src/output-inventory.ts";
const item = (cameraId:string, outputMode:"production"|"diagnostic", recordingEnabled=true, youtubeRelayActive=false) => ({cameraId,outputMode,running:true,recordingEnabled,youtubeRelayActive});
test("separates clean and diagnostic recording counts",()=>{
 const report=summarizeOutputInventory([item("A","production"),item("B","diagnostic")]);
 assert.deepEqual(report.cleanRecording,["A"]);
 assert.deepEqual(report.diagnosticRecording,["B"]);
});
test("distinguishes streaming from recording",()=>{
 const report=summarizeOutputInventory([item("A","production",true,true),item("B","diagnostic",true,false)]);
 assert.deepEqual(report.cleanStreaming,["A"]);
 assert.deepEqual(report.diagnosticStreaming,[]);
});
test("ignores stopped captures",()=>{
 assert.deepEqual(summarizeOutputInventory([{...item("A","production"),running:false}]).production,[]);
});
test("rejects duplicate camera identities",()=>{
 assert.throws(()=>summarizeOutputInventory([item("A","production"),item("A","diagnostic")]),/Duplicate/);
});
test("flags any diagnostic YouTube relay",()=>{
 assert.throws(()=>assertNoUnverifiedDiagnosticRelays([item("B","diagnostic",true,true)]),/Unverified/);
});
test("permits production relays and local diagnostic recordings",()=>{
 assert.doesNotThrow(()=>assertNoUnverifiedDiagnosticRelays([item("A","production",true,true),item("B","diagnostic")]));
});
