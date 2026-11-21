import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyEventPass,eventPassStatus,EventEntitlementStore} from '../apps/node-service/src/event-entitlement.ts';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'});
const now=Date.parse('2026-11-19T12:00:00Z');
const payload={schema:1,licenseId:'license-123',eventId:'event-123',issuedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+30*86400000).toISOString(),durationDays:10,maxNodes:2,allowedNodeIds:['node-123','node-456']};
const signed=(p=payload)=>({payload:p,signature:sign(null,Buffer.from(JSON.stringify(p)),privateKey).toString('base64')});
test('accepts genuine Ed25519 pass and rejects tampering',()=>{
 assert.equal(verifyEventPass(signed(),pem,now).licenseId,payload.licenseId);
 assert.throws(()=>verifyEventPass({...signed(),payload:{...payload,maxNodes:50}},pem,now),/Invalid event-pass signature/);
});
test('unactivated pass is free and cannot unlock paid tier',()=>{
 assert.equal(eventPassStatus(payload,null,'node-123',now).tier,'free');
 assert.equal(eventPassStatus(payload,{licenseId:payload.licenseId,eventId:payload.eventId,activatedAt:new Date(now).toISOString()},'wrong-node',now).tier,'free');
});
test('activation is explicit, persists, and expires after 10 days',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tsm-license-'));
 try{
  const store=new EventEntitlementStore(dir,pem,'node-123');
  await store.install(signed(),now);
  assert.equal(store.status(now).tier,'free');
  assert.equal((await store.activate(now)).tier,'event');
  assert.equal(store.status(now+10*86400000).tier,'free');
  const loaded=new EventEntitlementStore(dir,pem,'node-123');
  await loaded.load(now+1000);
  assert.equal(loaded.status(now+1000).tier,'event');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects unlisted nodes and malformed dates',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tsm-license-'));
 try{
  const store=new EventEntitlementStore(dir,pem,'unknown-node');
  await assert.rejects(store.install(signed(),now),/not authorized/);
  assert.throws(()=>verifyEventPass(signed({...payload,validUntil:'bad'}),pem,now),/dates/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
