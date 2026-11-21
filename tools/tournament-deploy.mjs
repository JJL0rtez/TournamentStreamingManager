#!/usr/bin/env node
// Batch 55: one-command host acceptance runner. No network disruption or stream controls.
import {readFile,writeFile,mkdir,unlink,stat} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {renderHtml} from './tournament-report-html.mjs';
const phases=['readiness','stress','multicam','observer'];
export function validatePlan(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Plan must be an object');
 if(!/^[a-zA-Z0-9_-]{1,40}$/.test(raw.hostId||''))throw Error('hostId must be 1..40 safe characters');
 if(typeof raw.recordings!=='string'||!raw.recordings.trim())throw Error('recordings path required');
 if(typeof raw.output!=='string'||!raw.output.trim())throw Error('output path required');
 if(raw.phases!==undefined&&(!Array.isArray(raw.phases)||raw.phases.length===0||raw.phases.some(p=>!phases.includes(p))||new Set(raw.phases).size!==raw.phases.length))throw Error('phases must be unique known names');
 if(raw.minFreeGb!==undefined&&(!Number.isFinite(raw.minFreeGb)||raw.minFreeGb<0))throw Error('minFreeGb invalid');
 if(raw.minMiBps!==undefined&&(!Number.isFinite(raw.minMiBps)||raw.minMiBps<=0))throw Error('minMiBps invalid');
 if(raw.autoObserveRecordings!==undefined&&typeof raw.autoObserveRecordings!=='boolean')throw Error('autoObserveRecordings must be boolean');
 if(raw.autoObserveRecordings&&(!raw.multicamConfig||!raw.observerPlan))throw Error('autoObserveRecordings requires multicamConfig and observerPlan');
 if(raw.autoObserveRecordings&&raw.observerMode==='sequential')throw Error('autoObserveRecordings requires concurrent observer mode');
 if(raw.observerMode!==undefined&&!['concurrent','sequential'].includes(raw.observerMode))throw Error('observerMode must be concurrent or sequential');
 if(raw.phaseTimeoutSeconds!==undefined&&(!Number.isInteger(raw.phaseTimeoutSeconds)||raw.phaseTimeoutSeconds<30||raw.phaseTimeoutSeconds>14400))throw Error('phaseTimeoutSeconds must be 30..14400');
 if(raw.stressMiB!==undefined&&(!Number.isInteger(raw.stressMiB)||raw.stressMiB<1||raw.stressMiB>4096))throw Error('stressMiB must be 1..4096');
 for(const k of ['multicamConfig','observerPlan'])if(raw[k]!==undefined&&(typeof raw[k]!=='string'||!raw[k].trim()))throw Error(`${k} invalid`);
 const enabled=raw.phases??phases;
 if(enabled.includes('multicam')&&!raw.multicamConfig)throw Error('multicamConfig required');
 if(enabled.includes('observer')&&!raw.observerPlan)throw Error('observerPlan required');
 if(raw.autoObserveRecordings&&(!enabled.includes('multicam')||!enabled.includes('observer')))throw Error('autoObserveRecordings requires multicam and observer phases');
 return {...raw,phases:enabled};
}
export function parseDeployArgs(args){const o={};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--dry-run'){o.dryRun=true;continue;}if(k==='--help'){o.help=true;continue;}if(k!=='--plan')throw Error(`Unknown option ${k}`);if(!args[i+1])throw Error('Missing --plan value');o.plan=resolve(args[++i]);}if(!o.help&&!o.plan)throw Error('--plan required');return o;}
export function phaseCommand(phase,plan,base,out){
 const path=p=>isAbsolute(p)?p:resolve(base,p),report=join(out,`${plan.hostId}-${phase}.json`);
 if(phase==='readiness')return {script:'tournament-readiness.mjs',args:['--recordings',path(plan.recordings),'--min-free-gb',String(plan.minFreeGb??100),'--probe-media','--report',report],report};
 if(phase==='stress')return {script:'tournament-stress.mjs',args:['--directory',path(plan.recordings),'--size-mib',String(plan.stressMiB??512),'--min-mibps',String(plan.minMiBps??25),'--report',report],report};
 if(phase==='multicam')return {script:'tournament-multicam.mjs',args:['--config',path(plan.multicamConfig),'--output',join(out,'recording-test'),'--report',report],report};
 if(phase==='observer')return {script:'tournament-observer.mjs',args:['--plan',path(plan.observerPlan),'--report',report],report};
 throw Error(`Unknown phase ${phase}`);
}
// Each phase has an independent timeout. Terminate the process tree on Windows so
// FFmpeg children cannot remain running after a timed-out acceptance test.
export function spawnPhase(script,args,{cwd=process.cwd(),timeoutMs=900000,spawnFn=spawn}={}){
 return new Promise(done=>{
  let settled=false,log='',child,timer;
  const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);done({...result,log:log.slice(-12000)});};
  try{child=spawnFn(process.execPath,[script,...args],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch(e){finish({ok:false,error:e.message});return;}
  const terminate=()=>{
   if(process.platform==='win32'){
    try{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}
    catch{child.kill();}
   }else{try{child.kill('SIGTERM');}catch{}}
  };
  timer=setTimeout(()=>{terminate();finish({ok:false,error:'PHASE_TIMEOUT'});},timeoutMs);
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{log=(log+chunk.toString()).slice(-12000);});
  child.on('error',e=>finish({ok:false,error:e.message}));
  child.on('close',(code,signal)=>finish({ok:code===0,code,signal}));
 });
}
export function schedulePhases(plan){
 const phases=plan.phases;
 if(plan.observerMode==='sequential'||!phases.includes('observer')||!phases.includes('multicam'))return phases.map(p=>[p]);
 const groups=[];
 for(const phase of phases){
  if(phase==='observer')continue;
  if(phase==='multicam')groups.push(['observer','multicam']);
  else groups.push([phase]);
 }
 return groups;
}
// Derive recording paths from the same camera configuration and output directory
// used by the actual multicam runner. This avoids stale manually configured paths.
export function deriveObserverPlan(observer, multicam, recordingDir) {
 if (!observer || !Array.isArray(observer.endpoints) || !Array.isArray(observer.recordings)) throw Error('Invalid observer plan');
 if (!multicam || !Array.isArray(multicam.cameras) || !multicam.cameras.length) throw Error('Invalid multicam config');
 const ids=new Set();
 const recordings=multicam.cameras.map(camera=>{
  if(!camera || typeof camera.id!=='string'|| !/^[a-zA-Z0-9_-]{1,40}$/.test(camera.id)||ids.has(camera.id))throw Error('Invalid or duplicate camera ID');
  ids.add(camera.id);
  return {id:camera.id,path:join(recordingDir,`${camera.id}.mkv`),minGrowthBytes:1};
 });
 const captureDuration=multicam.durationSeconds??60;
 if(!Number.isInteger(captureDuration)||captureDuration<10||captureDuration>3600)throw Error('Invalid capture duration');
 const interval=observer.intervalSeconds??5;
 if(!Number.isInteger(interval)||interval<1||interval>60)throw Error('Invalid observer interval');
 // Stop before the recording completes; the final samples must measure live growth.
 const durationSeconds=Math.max(10,Math.min(observer.durationSeconds??captureDuration,captureDuration-2));
 if(captureDuration<15)throw Error('Capture duration must be at least 15 seconds for concurrent observation');
 if(Math.ceil(durationSeconds/interval)<2)throw Error('Observation requires at least two samples');
 return {...observer,durationSeconds,recordings,initialMissingGraceSamples:observer.initialMissingGraceSamples??2};
}
export async function runDeployment(plan,{base=process.cwd(),run=spawnPhase,now=()=>new Date(),dryRun=false}={}){
 const out=isAbsolute(plan.output)?plan.output:resolve(base,plan.output);
 const commands=plan.phases.map(phase=>({phase,...phaseCommand(phase,plan,base,out)}));
 const groups=schedulePhases(plan);
 if(dryRun)return {dryRun:true,host:plan.hostId,groups,commands:commands.map(c=>({...c,program:process.execPath,script:resolve(dirname(new URL(import.meta.url).pathname),c.script)}))};
 await mkdir(out,{recursive:true});const results=[];
 // Remove every prior report before running any phases to prevent stale success.
 for(const cmd of commands)await unlink(cmd.report).catch(e=>{if(e.code!=='ENOENT')throw e;});
 const byPhase=new Map(commands.map(c=>[c.phase,c]));
 if(plan.autoObserveRecordings && plan.phases.includes('multicam') && plan.phases.includes('observer')){
  if(plan.observerMode==='sequential')throw Error('autoObserveRecordings requires concurrent observer mode');
  const resolveInput=p=>isAbsolute(p)?p:resolve(base,p);
  const [cameraConfig,observerConfig]=await Promise.all([
   readFile(resolveInput(plan.multicamConfig),'utf8').then(JSON.parse),
   readFile(resolveInput(plan.observerPlan),'utf8').then(JSON.parse)
  ]);
  const generated=deriveObserverPlan(observerConfig,cameraConfig,join(out,'recording-test'));
  const generatedPath=join(out,`${plan.hostId}-observer-generated.json`);
  await writeFile(generatedPath,JSON.stringify(generated,null,2)+'\n');
  const cmd=byPhase.get('observer');
  cmd.args[cmd.args.indexOf('--plan')+1]=generatedPath;
 }

 for(const group of groups){
  const groupResults=await Promise.all(group.map(async phase=>{
   const cmd=byPhase.get(phase),script=resolve(dirname(new URL(import.meta.url).pathname),cmd.script);
   const started=Date.now();
   if(group.length>1&&phase==='observer')await new Promise(resolve=>setTimeout(resolve,1500));
   const execution=await run(script,cmd.args,{timeoutMs:(plan.phaseTimeoutSeconds??900)*1000});
   let report=null,reportError=null;
   try{
    const file=await stat(cmd.report);
    if(file.mtimeMs<started-2000)throw Error('STALE_REPORT');
    report=JSON.parse(await readFile(cmd.report,'utf8'));
   }catch(e){reportError=e.message;}
   const reportedStatus=report?.status??report?.summary?.status;
   // A zero exit code and an unrelated or malformed report must never count as success.
   const validReport=report&&typeof report==='object'&&!Array.isArray(report)&&['pass','warn','fail'].includes(reportedStatus);
   const status=execution.ok&&validReport&&reportedStatus==='pass'?'pass':execution.ok&&validReport&&reportedStatus==='warn'?'warn':'fail';
   return {phase:cmd.phase,status,elapsedSeconds:Math.round((Date.now()-started)/1000),report:cmd.report,reportError,exitCode:execution.code??null,error:execution.error??null,log:execution.log??''};
  }));
  results.push(...groupResults);
 }
 const failures=results.filter(x=>x.status==='fail').length,warnings=results.filter(x=>x.status==='warn').length;
 const summary={schemaVersion:2,generatedAt:now().toISOString(),host:plan.hostId,status:failures?'fail':warnings?'warn':'pass',failures,warnings,groups,results};
 const jsonPath=join(out,`${plan.hostId}-deployment.json`),htmlPath=join(out,`${plan.hostId}-deployment.html`);
 await writeFile(jsonPath,JSON.stringify(summary,null,2)+'\n');await writeFile(htmlPath,renderHtml(summary));
 return {...summary,jsonPath,htmlPath};
}
export async function main(args=process.argv.slice(2)){
 const o=parseDeployArgs(args);if(o.help){console.log('node tools/tournament-deploy.mjs --plan tools/deploy.example.json [--dry-run]');return 0;}
 const plan=validatePlan(JSON.parse(await readFile(o.plan,'utf8'))),result=await runDeployment(plan,{base:dirname(o.plan),dryRun:o.dryRun});
 console.log(JSON.stringify(result,null,2));return result.dryRun||result.status==='pass'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(c=>process.exitCode=c).catch(e=>{console.error(e.message);process.exitCode=2;});
