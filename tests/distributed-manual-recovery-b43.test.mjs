import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UnifiedRingLifecycle} from '../packages/capture-coordination/unified-lifecycle.mjs';
const identity={eventId:'event1',ringId:'ring1',nodeId:'node1'};
function setup(){
 let released=0;const incidents=[];
 const client={acquire:async()=>({ok:true,lease:{leaseId:'lease1',expiresAt:Date.now()+60000}}),release:async()=>{released++;return {ok:true};}};
 const lifecycle=new UnifiedRingLifecycle({client,identityFor:()=>identity,onIncident:e=>incidents.push(e)});
 return {lifecycle,incidents,get released(){return released;}};
}
test('successful restart retains ring lease and membership',async()=>{
 const x=setup();await x.lifecycle.start('capture','cam1',async()=>{});
 const result=await x.lifecycle.restart('capture','cam1',async()=> 'restarted');
 assert.equal(result,'restarted');assert.equal(x.released,0);
 assert.equal(x.lifecycle.hasMember('capture','cam1'),true);
 assert.equal(x.lifecycle.status()[0].state,'active');
 x.lifecycle.rings.get('event1:ring1').guard.stopHeartbeat();
});
test('untracked pipeline cannot invoke restart callback',async()=>{
 const x=setup();let invoked=false;
 await assert.rejects(x.lifecycle.restart('capture','cam1',async()=>{invoked=true;}),/UNTRACKED/);
 assert.equal(invoked,false);
});
test('failed restart retains lease but fences subsequent starts',async()=>{
 const x=setup();await x.lifecycle.start('capture','cam1',async()=>{});
 await assert.rejects(x.lifecycle.restart('capture','cam1',async()=>{throw Error('FFMPEG_FAILED');}),/FFMPEG_FAILED/);
 assert.equal(x.released,0);assert.equal(x.lifecycle.status()[0].state,'uncertain');
 await assert.rejects(x.lifecycle.start('capture','cam2',async()=>{}),/RING_OWNERSHIP_UNCERTAIN/);
 x.lifecycle.rings.get('event1:ring1').guard.stopHeartbeat();
});
test('lease loss during restart leaves membership reserved',async()=>{
 const x=setup();await x.lifecycle.start('capture','cam1',async()=>{});
 await assert.rejects(x.lifecycle.restart('capture','cam1',async()=>{x.lifecycle.rings.get('event1:ring1').guard.lease.expiresAt=Date.now()-1;}),/RING_OWNERSHIP_UNCERTAIN/);
 assert.equal(x.lifecycle.hasMember('capture','cam1'),true);assert.equal(x.released,0);
 x.lifecycle.rings.get('event1:ring1').guard.stopHeartbeat();
});
test('concurrent restart and stop are serialized',async()=>{
 const x=setup();await x.lifecycle.start('capture','cam1',async()=>{});
 let resume;const gate=new Promise(r=>resume=r);
 const restarting=x.lifecycle.restart('capture','cam1',async()=>{await gate;});
 await assert.rejects(x.lifecycle.stop('capture','cam1',async()=>{}),/PIPELINE_OPERATION_IN_PROGRESS/);
 resume();await restarting;
 x.lifecycle.rings.get('event1:ring1').guard.stopHeartbeat();
});
test('API manual recovery is lease-aware but watchdog requires separate opt-in',()=>{
 const src=readFileSync(new URL('../apps/node-service/src/api.ts',import.meta.url),'utf8');
 assert.match(src,/distributedCaptureLifecycle\.restart\("capture", cameraId, restartPipeline\)/);
 assert.match(src,/if \(!recoveryPolicy\.enabled \|\| \(distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn\)\) return/);
 assert.match(src,/stop\|recover/);
 assert.match(src,/UNTRACKED_PIPELINE_REQUIRES_MANUAL_RECOVERY/);
});
