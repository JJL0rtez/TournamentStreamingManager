#!/usr/bin/env node
// Evaluate planned outage/recovery drills from read-only observer samples.
// Operators create interruptions outside this program. No network mutations.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function validateDrill(d){
 if(!d||!Array.isArray(d.scenarios)||d.scenarios.length<1||d.scenarios.length>20)throw Error('1..20 scenarios required');
 const ids=new Set();
 for(const s of d.scenarios){
  if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id))throw Error('Invalid/duplicate scenario');ids.add(s.id);
  if(!['endpoint-outage','recording-continuity'].includes(s.type))throw Error('Invalid scenario type');
  if(typeof s.targetId!=='string'||!s.targetId)throw Error('targetId required');
  if(!Number.isInteger(s.startSample)||!Number.isInteger(s.endSample)||s.startSample<1||s.endSample<s.startSample)throw Error('Invalid sample range');
  if(s.maxRecoverySamples!==undefined&&(!Number.isInteger(s.maxRecoverySamples)||s.maxRecoverySamples<1||s.maxRecoverySamples>100))throw Error('Invalid recovery samples');
 }
 return d;
}
export function evaluateDrill(drill,observer){
 if(!observer||!Array.isArray(observer.samples)||observer.samples.length<3)throw Error('Observer needs at least 3 samples');
 const checks=[];
 for(const s of drill.scenarios){
  const range=observer.samples.slice(s.startSample,s.endSample+1);
  const before=observer.samples[s.startSample-1];
  const after=observer.samples.slice(s.endSample+1,s.endSample+1+(s.maxRecoverySamples??3));
  let status='fail',reason='NOT_OBSERVED';
  if(!before||range.length!==s.endSample-s.startSample+1||!after.length){reason='INSUFFICIENT_SAMPLES';}
  else if(s.type==='endpoint-outage'){
   const get=sample=>sample.endpoints?.find(e=>e.id===s.targetId);
   if(!get(before)?.ok)reason='ENDPOINT_NOT_HEALTHY_BEFORE';
   else if(!range.some(x=>get(x)?.ok===false))reason='OUTAGE_NOT_DETECTED';
   else if(!after.some(x=>get(x)?.ok===true))reason='ENDPOINT_NOT_RECOVERED';
   else {status='pass';reason='OUTAGE_DETECTED_AND_RECOVERED';}
  }else{
   const get=sample=>sample.recordings?.find(r=>r.id===s.targetId);
   const points=[before,...range,...after].map(get);
   if(points.some(p=>!p?.exists))reason='RECORDING_MISSING';
   else if(points.some((p,i)=>i>0&&p.bytes<points[i-1].bytes))reason='RECORDING_SHRANK';
   else if(points.at(-1).bytes<=points[0].bytes)reason='RECORDING_NOT_GROWING';
   else {status='pass';reason='RECORDING_CONTINUED';}
  }
  checks.push({id:s.id,type:s.type,targetId:s.targetId,status,reason});
 }
 return {schemaVersion:1,generatedAt:new Date().toISOString(),status:checks.every(c=>c.status==='pass')?'pass':'fail',checks};
}
export async function main(args=process.argv.slice(2)){
 let plan,observer,output='fault-review.json';
 for(let i=0;i<args.length;i++){if(args[i]==='--plan')plan=args[++i];else if(args[i]==='--observer')observer=args[++i];else if(args[i]==='--output')output=args[++i];else if(args[i]==='--help'){console.log('node tools/tournament-fault-review.mjs --plan tools/fault-review.example.json --observer observer.json --output fault-review.json');return 0;}else throw Error(`Unknown argument ${args[i]}`);}
 if(!plan||!observer)throw Error('--plan and --observer required');
 const result=evaluateDrill(validateDrill(JSON.parse(await readFile(plan,'utf8'))),JSON.parse(await readFile(observer,'utf8')));
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks,output},null,2));return result.status==='pass'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(c=>process.exitCode=c).catch(e=>{console.error(e.message);process.exitCode=2;});
