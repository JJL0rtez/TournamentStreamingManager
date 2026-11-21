import test from 'node:test';import assert from 'node:assert/strict';
import {validateDrill,evaluateDrill} from '../tools/tournament-fault-review.mjs';
const plan={scenarios:[{id:'net',type:'endpoint-outage',targetId:'coordinator',startSample:1,endSample:2},{id:'rec',type:'recording-continuity',targetId:'cam1',startSample:1,endSample:2}]};
function report(){return {samples:[true,false,false,true,true].map((ok,i)=>({endpoints:[{id:'coordinator',ok}],recordings:[{id:'cam1',exists:true,bytes:100+i*10}]}))};}
test('planned outage detected with recovery and recording growth',()=>assert.equal(evaluateDrill(validateDrill(plan),report()).status,'pass'));
test('no outage fails',()=>{const r=report();r.samples.forEach(s=>s.endpoints[0].ok=true);assert.equal(evaluateDrill(plan,r).checks[0].reason,'OUTAGE_NOT_DETECTED');});
test('no recovery fails',()=>{const r=report();r.samples.slice(3).forEach(s=>s.endpoints[0].ok=false);assert.equal(evaluateDrill(plan,r).checks[0].reason,'ENDPOINT_NOT_RECOVERED');});
test('recording stopped fails',()=>{const r=report();r.samples.forEach(s=>s.recordings[0].bytes=100);assert.equal(evaluateDrill(plan,r).checks[1].reason,'RECORDING_NOT_GROWING');});
test('recording missing fails',()=>{const r=report();r.samples[2].recordings[0].exists=false;assert.equal(evaluateDrill(plan,r).checks[1].reason,'RECORDING_MISSING');});
test('insufficient samples fails',()=>{const r=report();r.samples.length=3;assert.equal(evaluateDrill(plan,r).checks[0].reason,'INSUFFICIENT_SAMPLES');});
test('invalid scenario ranges rejected',()=>assert.throws(()=>validateDrill({scenarios:[{...plan.scenarios[0],startSample:4,endSample:2}]}),/range/));
