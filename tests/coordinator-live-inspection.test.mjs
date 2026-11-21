import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectCoordinatorRings} from '../packages/capture-coordination/live-inspection.mjs';
const session={eventId:'event1',assignments:[{ring:'ring1'},{ring:'ring2'}]};
const base={session,nodeId:'node1',url:'http://localhost:1234',secret:'a'.repeat(32)};
test('inspects each unique ring without mutating coordinator state',async()=>{
 const calls=[];const result=await inspectCoordinatorRings({...base,client:{inspect:async x=>{calls.push(x);return {ok:true,lease:null};}}});
 assert.equal(result.verified,true);assert.equal(result.safeToEnable,false);assert.deepEqual(calls.map(c=>c.ringId),['ring1','ring2']);
 assert.ok(calls.every(c=>c.eventId==='event1'&&c.nodeId==='node1'));
});
test('does not expose lease identifiers or secrets',async()=>{
 const result=await inspectCoordinatorRings({...base,client:{inspect:async()=>({ok:true,lease:{leaseId:'sensitive',nodeId:'node2',expiresAt:Date.now()+1000}})}});
 assert.equal(result.rings[0].occupied,true);assert.equal(result.rings[0].ownerNodeId,'node2');
 assert.doesNotMatch(JSON.stringify(result),/sensitive|aaaaaaaa/);
});
test('network failure fails closed and preserves partial diagnostic results',async()=>{
 let i=0;const result=await inspectCoordinatorRings({...base,client:{inspect:async()=>{if(++i===2)throw Error('secret token');return {ok:true,lease:null};}}});
 assert.equal(result.verified,false);assert.equal(result.rings.length,2);assert.equal(result.rings[1].code,'COORDINATOR_UNREACHABLE');
 assert.doesNotMatch(JSON.stringify(result),/secret token/);
});
test('missing credentials never contacts coordinator',async()=>{
 const result=await inspectCoordinatorRings({...base,secret:'short',client:{inspect:()=>{throw Error('should not run');}}});
 assert.equal(result.code,'COORDINATOR_CONFIGURATION_REQUIRED');
});
test('invalid or oversized ring lists never contact coordinator',async()=>{
 const result=await inspectCoordinatorRings({...base,session:{eventId:'event1',assignments:Array.from({length:17},(_,i)=>({ring:`r${i}`}))},client:{inspect:()=>{throw Error('should not run');}}});
 assert.equal(result.code,'INVALID_RING_ASSIGNMENTS');
});
test('endpoint is read-only and responds with no-store',()=>{
 const api=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
 const a=api.indexOf('app.get("/api/captures/coordinator-inspection"');const b=api.indexOf('app.get("/api/youtube/coordination"',a);
 assert.ok(a>0&&b>a);const body=api.slice(a,b);
 assert.match(body,/inspectCoordinatorRings/);assert.match(body,/no-store/);
 assert.doesNotMatch(body,/\.acquire\(|\.release\(|\.start\(|\.stop\(/);
});
