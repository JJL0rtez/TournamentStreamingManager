import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deriveObserverPlan,validatePlan,runDeployment} from '../tools/tournament-deploy.mjs';
import {evaluateProbe} from '../tools/tournament-multicam.mjs';
const cameras={durationSeconds:30,cameras:[{id:'ring1',video:'camera1'},{id:'ring2',video:'camera2'}]};
const observer={endpoints:[],recordings:[{id:'old',path:'wrong.mkv'}],intervalSeconds:2,durationSeconds:120};
test('auto-generated observer watches exactly the active camera files',()=>{
 const p=deriveObserverPlan(observer,cameras,'C:/records');
 assert.deepEqual(p.recordings.map(r=>r.id),['ring1','ring2']);
 assert.ok(p.recordings[0].path.endsWith('ring1.mkv'));
 assert.equal(p.durationSeconds,28);
 assert.equal(p.initialMissingGraceSamples,2);
});
test('reject duplicate camera IDs in observer generation',()=>assert.throws(()=>deriveObserverPlan(observer,{...cameras,cameras:[cameras.cameras[0],cameras.cameras[0]]},'test'),/duplicate/));
test('reject unsafe camera IDs',()=>assert.throws(()=>deriveObserverPlan(observer,{...cameras,cameras:[{id:'../x'}]},'test'),/Invalid/));
test('reject nonboolean autoObserveRecordings',()=>assert.throws(()=>validatePlan({hostId:'PC1',recordings:'r',output:'o',phases:['readiness'],multicamConfig:'a',observerPlan:'b',autoObserveRecordings:'yes'}),/boolean/));
test('ffprobe fps threshold compares with requested 60fps, not 1fps',()=>{
 const probe={streams:[{codec_type:'video',width:1920,height:1080,avg_frame_rate:'30/1'}],format:{duration:'30'}};
 assert.ok(evaluateProbe(probe,30,{expectedFps:60}).reasons.includes('FRAME_RATE_INVALID'));
 assert.ok(evaluateProbe(probe,30,{expectedFps:30}).ok);
});
test('generated observer plan is passed to observer runner',async()=>{
 const base=await mkdtemp(join(tmpdir(),'tsm57-'));
 await writeFile(join(base,'cams.json'),JSON.stringify(cameras));
 await writeFile(join(base,'observer.json'),JSON.stringify(observer));
 let observerArgs;
 const plan=validatePlan({hostId:'PC1',recordings:'recordings',output:'reports',phases:['multicam','observer'],multicamConfig:'cams.json',observerPlan:'observer.json',autoObserveRecordings:true});
 const run=async(script,args)=>{
  if(script.endsWith('tournament-observer.mjs'))observerArgs=args;
  const report=args[args.indexOf('--report')+1];await mkdir(join(base,'reports'),{recursive:true});
  await writeFile(report,JSON.stringify({status:'pass'}));
  return {ok:true,code:0};
 };
 const result=await runDeployment(plan,{base,run});
 assert.equal(result.status,'pass');
 const generated=JSON.parse(await readFile(observerArgs[observerArgs.indexOf('--plan')+1],'utf8'));
 assert.deepEqual(generated.recordings.map(r=>r.id),['ring1','ring2']);
 assert.equal(generated.durationSeconds,28);
});
test('automatic observer rejects sequential execution',async()=>{
 const base=await mkdtemp(join(tmpdir(),'tsm57-'));
 assert.throws(()=>validatePlan({hostId:'PC1',recordings:'recordings',output:'reports',phases:['multicam','observer'],multicamConfig:'cams.json',observerPlan:'observer.json',autoObserveRecordings:true,observerMode:'sequential'}),/concurrent/);
});
