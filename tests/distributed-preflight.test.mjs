import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateOwnershipReadiness as evaluate} from '../packages/capture-coordination/readiness.mjs';
const session={eventId:'event_1',assignments:[{cameraId:'cam1',ring:'ring1'}]};
const base={session,nodeId:'node1',coordinatorConfigured:true};
test('clean idle configuration is eligible for controlled integration, not permission to start',()=>{
 const result=evaluate(base);assert.equal(result.readyForControlledIntegration,true);assert.equal(result.mode,'read-only');
});
test('active captures block enablement',()=>{
 const result=evaluate({...base,active:{captures:['cam1']}});assert.equal(result.readyForControlledIntegration,false);assert.ok(result.problems.some(p=>p.code==='ACTIVE_PIPELINES_REQUIRE_RECONCILIATION'));
});
test('unassigned active camera is rejected',()=>{
 const result=evaluate({...base,active:{recordings:['unknown']}});assert.ok(result.problems.some(p=>p.code==='ACTIVE_CAMERA_ASSIGNMENT_MISSING_OR_DUPLICATED'));
});
test('duplicate assignment is rejected',()=>{
 const result=evaluate({...base,session:{...session,assignments:[...session.assignments,...session.assignments]}});assert.ok(result.problems.some(p=>p.code==='DUPLICATE_CAMERA_ASSIGNMENT'));
});
test('ring collisions are visible',()=>{
 const result=evaluate({...base,session:{...session,assignments:[...session.assignments,{cameraId:'cam2',ring:'ring1'}]}});assert.ok(result.problems.some(p=>p.code==='MULTIPLE_CAMERAS_ON_RING'));
});
test('uncertain claims block enablement',()=>{
 const result=evaluate({...base,claims:[{ring:'ring1',state:'uncertain'}]});assert.ok(result.problems.some(p=>p.code==='UNCERTAIN_EXISTING_LEASE'));
});
test('missing coordinator configuration blocks enablement',()=>{
 assert.ok(evaluate({...base,coordinatorConfigured:false}).problems.some(p=>p.code==='COORDINATOR_CONFIGURATION_REQUIRED'));
});
test('shared capture and recording overlap is detected',()=>{
 assert.ok(evaluate({...base,active:{captures:['cam1'],recordings:['cam1']}}).problems.some(p=>p.code==='CAPTURE_RECORDING_OVERLAP'));
});
test('route remains explicitly read-only and non-mutating',()=>{
 const api=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
 const start=api.indexOf('app.get("/api/captures/distributed-preflight"');assert.ok(start>0);
 const end=api.indexOf('app.get("/api/youtube/coordination"',start);
 const body=api.slice(start,end);assert.match(body,/unifiedOwnershipEnabled: false/);assert.doesNotMatch(body,/\.start\(|\.stop\(|\.acquire\(|\.release\(/);
});
