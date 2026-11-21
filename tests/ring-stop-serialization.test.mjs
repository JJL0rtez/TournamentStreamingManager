import test from 'node:test';
import assert from 'node:assert/strict';
import {UnifiedRingLifecycle} from '../packages/capture-coordination/unified-lifecycle.mjs';
const identityFor=()=>({eventId:'event',ringId:'ring',nodeId:'node'});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(){let releases=0;const client={acquire:async()=>({ok:true,lease:{leaseId:'l'}}),renew:async()=>({ok:true,lease:{leaseId:'l'}}),release:async()=>{releases++;return {ok:true}}};return {lifecycle:new UnifiedRingLifecycle({client,identityFor}),getReleases:()=>releases};}
test('stop of one camera blocks simultaneous stop of another camera on same ring',async()=>{
 const {lifecycle,getReleases}=setup();await lifecycle.start('capture','cam1',async()=>{});await lifecycle.start('capture','cam2',async()=>{});
 const gate=defer();const stopping=lifecycle.stop('capture','cam1',()=>gate.promise);
 await assert.rejects(lifecycle.stop('capture','cam2',async()=>{}),/RING_STOP_IN_PROGRESS/);
 gate.resolve();await stopping;assert.equal(getReleases(),0);
 await lifecycle.stop('capture','cam2',async()=>{});assert.equal(getReleases(),1);
});
test('start on same ring is blocked while stop is in flight',async()=>{
 const {lifecycle}=setup();await lifecycle.start('capture','cam1',async()=>{});
 const gate=defer();const stopping=lifecycle.stop('capture','cam1',()=>gate.promise);
 await assert.rejects(lifecycle.start('youtube','cam2',async()=>{}),/RING_STOP_IN_PROGRESS/);
 gate.resolve();await stopping;await lifecycle.start('capture','cam2',async()=>{});
});
test('stop failure clears operation lock but keeps ownership uncertain',async()=>{
 const {lifecycle}=setup();await lifecycle.start('capture','cam1',async()=>{});
 await assert.rejects(lifecycle.stop('capture','cam1',async()=>{throw Error('stop failed')}),/stop failed/);
 await assert.rejects(lifecycle.start('youtube','cam2',async()=>{}),/RING_OWNERSHIP_UNCERTAIN/);
});
test('lease loss blocks new members even if callback is delayed',async()=>{
 const {lifecycle}=setup();await lifecycle.start('capture','cam1',async()=>{});
 const entry=[...lifecycle.rings.values()][0];entry.guard.lost=true;
 await assert.rejects(lifecycle.start('youtube','cam2',async()=>{}),/RING_OWNERSHIP_UNCERTAIN/);
});
