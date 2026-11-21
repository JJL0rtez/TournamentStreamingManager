import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runIncidentReplay,validateReplayScenario,compareReplayReports} from '../apps/node-service/src/incident-replay.ts';
const scenario=JSON.parse(await readFile(new URL('../scenarios/multi-pc-failures.json',import.meta.url),'utf8'));
test('sample: multi-PC freeze, silence and YouTube failures recover',()=>{
 const result=runIncidentReplay(scenario);
 assert.equal(result.incidents.length,3);
 assert.equal(result.unresolved,0);
 assert.equal(result.expectations.failed,0);
 assert.equal(result.incidents[0].peak,'failed');
 assert.equal(result.incidents[0].openedAtMs,10000);
 assert.equal(result.incidents[0].closedAtMs,45000);
});
test('replay deterministic for unordered input and equal-time events',()=>{
 const events=[{atMs:10,node:'main',ring:'ring-1',signal:'video',state:'failed'},
 {atMs:0,node:'main',ring:'ring-1',signal:'video',state:'degraded'},
 {atMs:10,node:'main',ring:'ring-1',signal:'video',state:'ok'}];
 const report=runIncidentReplay({version:1,name:'sort',durationMs:20,events});
 assert.equal(report.incidents[0].closedAtMs,10);
 assert.equal(report.unresolved,0);
});
test('unresolved failure is preserved',()=>{
 const s={version:1,name:'disk',durationMs:100,events:[{atMs:1,node:'main',ring:'ring-2',signal:'disk',state:'failed'}]};
 assert.equal(runIncidentReplay(s).unresolved,1);
});
test('expectation failures and regression comparison',()=>{
 const candidate=structuredClone(scenario);
 candidate.events=candidate.events.filter(e=>e.signal!=='youtube');
 const base=runIncidentReplay(scenario),next=runIncidentReplay(candidate);
 assert.equal(next.expectations.failed,2);
 assert.equal(compareReplayReports(base,next).regressed,true);
});
test('reject malformed scenario, huge duration, and invalid event',()=>{
 assert.throws(()=>validateReplayScenario({}),/header/);
 assert.throws(()=>validateReplayScenario({...scenario,durationMs:1e12}),/duration/);
 assert.throws(()=>validateReplayScenario({...scenario,events:[{...scenario.events[0],signal:'malicious'}]}),/event/);
});
test('scenario is not mutated by simulation',()=>{
 const before=JSON.stringify(scenario);
 runIncidentReplay(scenario);
 assert.equal(JSON.stringify(scenario),before);
});
