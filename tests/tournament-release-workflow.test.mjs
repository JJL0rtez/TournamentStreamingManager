import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_DRILLS } from '../tools/tournament-release-check.mjs';
import {parseWorkflowArgs, initializePlan, recordDrillInPlan, recordDrill, summarizePlan, main} from '../tools/tournament-release-workflow.mjs';
const fixed=Date.parse('2027-03-01T12:00:00Z');
const template={eventId:'event2027',expectedCameras:8,gateReport:'gate.json',deployments:[{hostId:'PC1',report:'PC1.json'}],drills:REQUIRED_DRILLS.map(id=>({id,status:'pass',observedAt:new Date(fixed).toISOString(),operator:'Person',evidence:'Previous event evidence must not carry forward'}))};
async function sandbox(fn){const dir=await mkdtemp(join(tmpdir(),'release-workflow-'));try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('arg parser rejects unknown, repeated and unsafe command flags',()=>{
 assert.throws(()=>parseWorkflowArgs(['record','--plan','x']),/required/);
 assert.throws(()=>parseWorkflowArgs(['status','--plan','x','--evidence','secret']),/cannot be used/);
 assert.throws(()=>parseWorkflowArgs(['status','--plan','x','--plan','y']),/Duplicate/);
 assert.equal(parseWorkflowArgs(['status','--plan','x']).command,'status');
});
test('new event plan clears every previously approved drill and does not overwrite existing plan',()=>sandbox(async dir=>{
 const source=join(dir,'template.json'), target=join(dir,'event.json');await writeFile(source,JSON.stringify(template));
 await initializePlan(source,target);const output=JSON.parse(await readFile(target,'utf8'));
 assert.equal(output.drills.length,8);assert.ok(output.drills.every(d=>d.status==='pending'&&!d.operator&&!d.evidence));
 await assert.rejects(()=>initializePlan(source,target),{code:'EEXIST'});
}));
test('record requires operator and evidence for pass or fail, and cannot invent arbitrary drill IDs',()=>{
 assert.throws(()=>recordDrillInPlan(template,{drillId:'made-up',status:'pass'}),/Unknown/);
 assert.throws(()=>recordDrillInPlan(template,{drillId:REQUIRED_DRILLS[0],status:'pass',operator:'O',evidence:'long enough evidence'}),/Operator/);
 assert.throws(()=>recordDrillInPlan(template,{drillId:REQUIRED_DRILLS[0],status:'pass',operator:'Operator',evidence:'short'}),/Evidence/);
 const updated=recordDrillInPlan(template,{drillId:REQUIRED_DRILLS[0],status:'fail',operator:'Operator',evidence:'Camera did not recover',observedAt:new Date(fixed).toISOString()});
 assert.equal(updated.drills[0].status,'fail');assert.equal(template.drills[0].status,'pass');
});
test('pass requires explicit confirmation, and recording creates a backup without leaking evidence to summary',()=>sandbox(async dir=>{
 const file=join(dir,'event.json');await writeFile(file,JSON.stringify({...template,drills:[]}));
 await assert.rejects(()=>main(['record','--plan',file,'--drill','audio-review','--status','pass','--operator','Operator','--evidence','Audited recording audio for each ring']),/confirm-observed/);
 const result=await recordDrill(file,{drillId:'audio-review',status:'pass',operator:'Operator',evidence:'Audio reviewed and clear on all cameras'},{now:fixed});
 assert.match(result.backup,/\.bak$/);const files=await readdir(dir);assert.equal(files.filter(f=>f.endsWith('.bak')).length,1);
 const updated=JSON.parse(await readFile(file,'utf8'));assert.equal(updated.drills[0].status,'pass');
 const summary=JSON.stringify(summarizePlan(updated,{now:fixed}));assert.doesNotMatch(summary,/Operator|Audio reviewed/);assert.equal(JSON.parse(summary).passed,1);
}));
test('pending reset clears old evidence, stale and future pass do not count as current',()=>{
 const reset=recordDrillInPlan(template,{drillId:'audio-review',status:'pending'});
 assert.equal(reset.drills[1].evidence,'');
 const stale=summarizePlan(template,{now:fixed+4*3600000});assert.ok(stale.drills.every(d=>d.status==='stale'));
 const future=summarizePlan(template,{now:fixed-3*60000});assert.ok(future.drills.every(d=>d.status==='stale'));
});
test('workflow check uses existing release gate and fails closed on missing reports',()=>sandbox(async dir=>{
 const file=join(dir,'plan.json'),out=join(dir,'out.json');await writeFile(file,JSON.stringify(template));
 const code=await main(['check','--plan',file,'--output',out]);assert.equal(code,1);
 const report=JSON.parse(await readFile(out,'utf8'));assert.equal(report.status,'not-ready');assert.ok(report.failures>0);
}));
