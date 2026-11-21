import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_DRILLS, validateReleasePlan, assessRelease, runReleaseCheck, parseArgs } from '../tools/tournament-release-check.mjs';
const now = Date.parse('2027-02-01T12:00:00Z');
const stamp = new Date(now-20000).toISOString();
function fixtures() {
  const plan = { eventId:'spring-2027', expectedCameras: 3, gateReport:'gate.json', deployments:[{hostId:'PC1', report:'PC1.json'},{hostId:'PC2',report:'PC2.json'}], drills:REQUIRED_DRILLS.map(id=>({id,status:'pass',observedAt:stamp,operator:'Operator',evidence:'Verified by visual and audio inspection'})) };
  const docs = {gate:{status:'pass', failures:0,warnings:0,expectedCameras:3,observedCameras:3,generatedAt:stamp},deployments:Object.fromEntries(['PC1','PC2'].map(host=>[host,{host,status:'pass',failures:0,warnings:0,generatedAt:stamp,results:['readiness','stress','multicam','observer'].map(phase=>({phase,status:'pass'}))}]))};
  return {plan,docs};
}
test('complete evidence results in operator review, never automatic production certification',()=>{
 const {plan,docs}=fixtures(); const result=assessRelease(plan,docs,{now});
 assert.equal(result.status,'ready-for-operator-review');assert.equal(result.failures,0);assert.equal(result.checks.length,17);
});
test('missing or pending drills reject release',()=>{
 const {plan,docs}=fixtures();plan.drills[2].status='pending';plan.drills[3].evidence='short';
 const result=assessRelease(plan,docs,{now});assert.equal(result.status,'not-ready');assert.equal(result.failures,2);
});
test('stale, future and unknown report timestamps fail closed',()=>{
 const {plan,docs}=fixtures();docs.gate.generatedAt=new Date(now-4*3600*1000).toISOString();docs.deployments.PC1.generatedAt=new Date(now+120000).toISOString();docs.deployments.PC2.generatedAt='garbage';
 assert.equal(assessRelease(plan,docs,{now}).failures,3);
});
test('warnings, missing camera results and incomplete phases block readiness',()=>{
 const {plan,docs}=fixtures();docs.gate.warnings=1;docs.gate.observedCameras=2;docs.deployments.PC1.results.pop();
 const report=assessRelease(plan,docs,{now});assert.equal(report.status,'not-ready');assert.equal(report.failures,3);
});
test('plan rejects duplicate hosts, duplicate drills and invalid camera count',()=>{
 const {plan}=fixtures();assert.throws(()=>validateReleasePlan({...plan,expectedCameras:9}),/expectedCameras/);
 assert.throws(()=>validateReleasePlan({...plan,deployments:[plan.deployments[0],plan.deployments[0]]}),/duplicate/);
 assert.throws(()=>validateReleasePlan({...plan,drills:[plan.drills[0],plan.drills[0]]}),/duplicate/);
});
test('file runner includes SHA256 provenance, omits operator evidence, reports absent source', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'release-test-'));
 try{
  const {plan,docs}=fixtures();await writeFile(join(dir,'plan.json'),JSON.stringify(plan));await writeFile(join(dir,'gate.json'),JSON.stringify(docs.gate));await writeFile(join(dir,'PC1.json'),JSON.stringify(docs.deployments.PC1));await writeFile(join(dir,'PC2.json'),JSON.stringify(docs.deployments.PC2));
  const out=join(dir,'release-report.json');const result=await runReleaseCheck(join(dir,'plan.json'),{now,outputPath:out});
  assert.equal(result.failures,0);assert.equal(result.sources.length,3);assert.match(result.sources[0].sha256,/^[a-f0-9]{64}$/);
  const output=await readFile(out,'utf8');assert.doesNotMatch(output,/Verified by visual/);assert.doesNotMatch(output,/Operator/);
  await rm(join(dir,'PC2.json'));
  const failure=await runReleaseCheck(join(dir,'plan.json'),{now});assert.notEqual(failure.failures,0);assert.equal(failure.sources[2].error,'REPORT_UNAVAILABLE');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('argument parsing is strict',()=>{
 assert.deepEqual(parseArgs(['--plan','plan.json','--output','report.json']),{plan:'plan.json',output:'report.json'});
 assert.throws(()=>parseArgs(['--plan']),/Missing/);assert.throws(()=>parseArgs(['--foo']),/Unknown/);
});
