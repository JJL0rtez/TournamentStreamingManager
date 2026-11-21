import test from 'node:test';
import assert from 'node:assert/strict';
import {CaptureLeaseGuard} from '../packages/capture-coordination/client.mjs';
import {UnifiedRingLifecycle} from '../packages/capture-coordination/unified-lifecycle.mjs';
const identity={eventId:'event1',ringId:'ring1',nodeId:'node1',sessionId:'session1'};
test('expired acquire is rejected before capture starts',async()=>{
 const guard=new CaptureLeaseGuard({acquire:async()=>({ok:true,lease:{leaseId:'x',expiresAt:Date.now()-1}})},identity);
 await assert.rejects(guard.acquire(),/LEASE_ACQUIRE_INVALID_EXPIRY/);
});
test('expired renew fails closed and reports loss',async()=>{
 let lost=0;
 const guard=new CaptureLeaseGuard({acquire:async()=>({ok:true,lease:{leaseId:'x',expiresAt:Date.now()+60000}}),renew:async()=>({ok:true,lease:{leaseId:'x',expiresAt:Date.now()-1}})},identity,{onLeaseLost:()=>lost++});
 await guard.acquire();await guard.renewOnce();assert.equal(guard.lost,true);assert.equal(lost,1);assert.equal(guard.isUsable(),false);
});
test('local expiry fences subsequent operations without a network request',async()=>{
 let lost=0;
 const guard=new CaptureLeaseGuard({acquire:async()=>({ok:true,lease:{leaseId:'x',expiresAt:Date.now()+5000}})},identity,{onLeaseLost:()=>lost++});
 await guard.acquire();guard.lease.expiresAt=Date.now()-1;
 assert.equal(guard.isUsable(),false);assert.equal(lost,1);
 assert.throws(()=>guard.startHeartbeat(),/LEASE_OWNERSHIP_UNCERTAIN/);
});
test('ring lifecycle refuses second pipeline after expiry and retains first',async()=>{
 let started=0;
 const client={acquire:async()=>({ok:true,lease:{leaseId:'x',expiresAt:Date.now()+60000}}),release:async()=>({ok:true})};
 const lifecycle=new UnifiedRingLifecycle({client,identityFor:()=>identity});
 await lifecycle.start('capture','camera1',async()=>{started++;});
 const entry=lifecycle.rings.get('event1:ring1');entry.guard.lease.expiresAt=Date.now()-1;
 await assert.rejects(lifecycle.start('recording','camera2',async()=>{started++;}),/RING_OWNERSHIP_UNCERTAIN/);
 assert.equal(started,1);assert.deepEqual(lifecycle.status()[0].members,['capture:camera1']);
 entry.guard.stopHeartbeat();
});
