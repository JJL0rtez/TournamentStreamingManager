import test from 'node:test';
import assert from 'node:assert/strict';
import {CaptureLeaseGuard} from '../packages/capture-coordination/client.mjs';
const identity={eventId:'event',ringId:'ring',nodeId:'node',sessionId:'session'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('one heartbeat in flight despite concurrent renew calls',async()=>{
 let resolveRenew;let calls=0;
 const client={acquire:async()=>({ok:true,lease:{leaseId:'one'}}),renew:()=>{calls++;return new Promise(resolve=>resolveRenew=resolve)},release:async()=>({ok:true})};
 const guard=new CaptureLeaseGuard(client,identity);await guard.acquire();
 const a=guard.renewOnce(),b=guard.renewOnce();assert.equal(calls,1);
 resolveRenew({ok:true,lease:{leaseId:'one'}});await Promise.all([a,b]);await guard.release();
});
test('release waits for heartbeat to finish before releasing',async()=>{
 let resolveRenew;const events=[];
 const client={acquire:async()=>({ok:true,lease:{leaseId:'one'}}),renew:()=>{events.push('renew');return new Promise(resolve=>resolveRenew=resolve)},release:async()=>{events.push('release');return {ok:true}}};
 const guard=new CaptureLeaseGuard(client,identity);await guard.acquire();
 const renewal=guard.renewOnce();const release=guard.release();await tick();assert.deepEqual(events,['renew']);
 resolveRenew({ok:true,lease:{leaseId:'one'}});await Promise.all([renewal,release]);assert.deepEqual(events,['renew','release']);
});
test('failed renewal marks lease uncertain and fires incident only once',async()=>{
 let incidents=0;const client={acquire:async()=>({ok:true,lease:{leaseId:'one'}}),renew:async()=>({ok:false,code:'EXPIRED'}),release:async()=>({ok:true})};
 const guard=new CaptureLeaseGuard(client,identity,{onLeaseLost:()=>incidents++});await guard.acquire();await guard.renewOnce();await guard.renewOnce();
 assert.equal(guard.lost,true);assert.equal(incidents,1);assert.throws(()=>guard.startHeartbeat(),/UNCERTAIN/);await guard.release();
});
test('failed release retains lease for manual recovery',async()=>{
 const client={acquire:async()=>({ok:true,lease:{leaseId:'one'}}),release:async()=>({ok:false,code:'RELEASE_FAILED'})};
 const guard=new CaptureLeaseGuard(client,identity);await guard.acquire();await assert.rejects(guard.release(),/RELEASE_FAILED/);
 assert.equal(guard.lease.leaseId,'one');assert.equal(guard.releasing,false);
});
