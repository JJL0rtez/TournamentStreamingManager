import test from 'node:test';import assert from 'node:assert/strict';
import {validateManifest,evaluateGate} from '../tools/tournament-gate.mjs';
const now=Date.now(),stamp=new Date(now).toISOString();
const manifest={expectedCameras:2,maxAgeMinutes:180,hosts:[{id:'PC1',cameraIds:['a'],readiness:'r',stress:'s',multicam:'m',observer:'o'},{id:'PC2',cameraIds:['b'],readiness:'r',stress:'s',multicam:'m',observer:'o'}]};
function hosts(){return manifest.hosts.map(h=>({id:h.id,cameraIds:h.cameraIds,reports:{readiness:{host:h.id,status:'pass',generatedAt:stamp},stress:{host:h.id,status:'pass',generatedAt:stamp},multicam:{host:h.id,status:'pass',generatedAt:stamp,cameras:[{cameraId:h.cameraIds[0],status:'pass',media:{duration:60}}]},observer:{host:h.id,status:'pass',generatedAt:stamp,sampleCount:3,checks:[]}}}));}
test('valid two host gate passes',()=>{const r=evaluateGate(validateManifest(manifest),hosts(),{now});assert.equal(r.status,'pass');assert.equal(r.observedCameras,2);});
test('duplicate assignments rejected',()=>assert.throws(()=>validateManifest({...manifest,hosts:[manifest.hosts[0],{...manifest.hosts[1],cameraIds:['a']}]}),/Duplicate/));
test('missing reports fail closed',()=>{const h=hosts();delete h[0].reports.stress;assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('stale reports fail',()=>{const h=hosts();h[0].reports.readiness.generatedAt=new Date(now-181*60000).toISOString();assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('wrong host fails',()=>{const h=hosts();h[0].reports.stress.host='PC2';assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('missing camera fails',()=>{const h=hosts();h[1].reports.multicam.cameras=[];assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('duplicate camera results fail',()=>{const h=hosts();h[0].reports.multicam.cameras.push({...h[0].reports.multicam.cameras[0]});assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('failed observer check fails',()=>{const h=hosts();h[0].reports.observer.checks=[{id:'coordinator',status:'fail'}];assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
test('warnings cannot pass readiness gate',()=>{const h=hosts();h[0].reports.readiness.status='warn';assert.equal(evaluateGate(manifest,h,{now}).status,'warn');});
test('short media fails',()=>{const h=hosts();h[0].reports.multicam.cameras[0].media.duration=2;assert.equal(evaluateGate(manifest,h,{now}).status,'fail');});
