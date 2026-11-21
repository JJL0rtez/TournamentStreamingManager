import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedRingLifecycle } from '../packages/capture-coordination/unified-lifecycle.mjs';

function setup(acquire) {
  let releases = 0;
  const client = {
    acquire,
    renew: async data => ({ok:true,lease:{leaseId:data.leaseId}}),
    release: async () => {releases++;return {ok:true};}
  };
  const gate = new UnifiedRingLifecycle({client,identityFor:()=>({eventId:'event1',ringId:'ring1',nodeId:'node1'})});
  return {gate,releases:()=>releases};
}

test('parallel cameras on one ring cannot both acquire first lease', async () => {
  let resume;
  const wait = new Promise(resolve => {resume = resolve;});
  let acquisitions = 0;
  const {gate} = setup(async () => {acquisitions++; await wait; return {ok:true,lease:{leaseId:'lease1'}};});
  const first = gate.start('capture','camera1',async()=> 'started');
  await assert.rejects(gate.start('capture','camera2',async()=> 'should-not-run'), /RING_ACQUIRE_IN_PROGRESS/);
  assert.equal(acquisitions,1);
  resume();
  assert.equal(await first,'started');
  assert.equal(await gate.start('youtube','camera2',async()=> 'relay'),'relay');
  assert.equal(acquisitions,1);
  await gate.stop('youtube','camera2',async()=>{});
  await gate.stop('capture','camera1',async()=>{});
});

test('failed acquisition clears ring lock for retry',async()=>{
  let attempts=0;
  const {gate}=setup(async()=> {attempts++; if(attempts===1) throw Error('NETWORK_UNAVAILABLE'); return {ok:true,lease:{leaseId:'lease2'}};});
  await assert.rejects(gate.start('capture','camera1',async()=>{}),/NETWORK_UNAVAILABLE/);
  assert.equal(await gate.start('capture','camera2',async()=> 'ok'),'ok');
  await gate.stop('capture','camera2',async()=>{});
  assert.equal(attempts,2);
});

test('start failure leaves ownership uncertain and blocks reuse',async()=>{
  const {gate,releases}=setup(async()=>({ok:true,lease:{leaseId:'lease3'}}));
  await assert.rejects(gate.start('capture','camera1',async()=>{throw Error('FFMPEG_UNCERTAIN');}),/FFMPEG_UNCERTAIN/);
  assert.equal(gate.status()[0].state,'uncertain');
  await assert.rejects(gate.start('youtube','camera2',async()=>{}),/RING_OWNERSHIP_UNCERTAIN/);
  assert.equal(releases(),0);
});
