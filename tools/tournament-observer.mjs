#!/usr/bin/env node
// Read-only multi-host availability, recording growth and coordinator health observer.
// Node 20+. Never sends mutations, stops FFmpeg, or modifies recordings.
import {stat,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export function validatePlan(plan){
 if(!plan||!Array.isArray(plan.endpoints)||!Array.isArray(plan.recordings))throw Error('Plan requires endpoints and recordings arrays');
 if(plan.endpoints.length===0&&plan.recordings.length===0)throw Error('Observer must monitor at least one endpoint or recording');
 if(plan.endpoints.length>32||plan.recordings.length>32)throw Error('Maximum 32 endpoints and 32 recordings');
 const ids=new Set();
 for(const e of plan.endpoints){
  if(!e||typeof e.id!=='string'||!e.id||ids.has('endpoint:'+e.id))throw Error('Invalid/duplicate endpoint ID');
  ids.add('endpoint:'+e.id);
  const url=new URL(e.url);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only credential-free HTTP(S) endpoint URLs');
  if(e.expectedStatus!==undefined&&(!Number.isInteger(e.expectedStatus)||e.expectedStatus<100||e.expectedStatus>599))throw Error('Invalid expectedStatus');
 }
 for(const r of plan.recordings){
  if(!r||typeof r.id!=='string'||!r.id||ids.has('recording:'+r.id)||typeof r.path!=='string'||!r.path)throw Error('Invalid recording');
  if(r.minGrowthBytes!==undefined&&(!Number.isSafeInteger(r.minGrowthBytes)||r.minGrowthBytes<1))throw Error('minGrowthBytes must be a positive integer');
  ids.add('recording:'+r.id);
 }
 if(plan.initialMissingGraceSamples!==undefined&&(!Number.isInteger(plan.initialMissingGraceSamples)||plan.initialMissingGraceSamples<0||plan.initialMissingGraceSamples>20))throw Error('initialMissingGraceSamples must be 0..20');
 const durationSeconds=plan.durationSeconds??60,intervalSeconds=plan.intervalSeconds??5,timeoutMs=plan.timeoutMs??3000;
 if(!Number.isInteger(durationSeconds)||durationSeconds<10||durationSeconds>7200)throw Error('durationSeconds must be 10..7200');
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<1||intervalSeconds>60)throw Error('intervalSeconds must be 1..60');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw Error('timeoutMs must be 100..30000');
 return {...plan,durationSeconds,intervalSeconds,timeoutMs};
}
export function parseArgs(argv){
 const out={plan:null,report:resolve('observer-report.json'),dryRun:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(a==='--help'){out.help=true;continue;}if(a==='--dry-run'){out.dryRun=true;continue;}
  if(!['--plan','--report'].includes(a))throw Error('Unknown option '+a);
  const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing '+a);
  out[a.slice(2)]=resolve(value);
 }
 if(!out.help&&!out.plan)throw Error('--plan required');return out;
}
export async function sample(plan,{fetchFn=fetch,statFn=stat,now=()=>Date.now()}={}){
 const timestamp=new Date(now()).toISOString();
 const endpoints=await Promise.all(plan.endpoints.map(async e=>{
  try{
   const started=now();
   const response=await fetchFn(e.url,{method:'GET',signal:AbortSignal.timeout(plan.timeoutMs),redirect:'error',headers:{'Cache-Control':'no-store'}});
   const expected=e.expectedStatus??200;
   return {id:e.id,ok:response.status===expected,status:response.status,latencyMs:now()-started};
  }catch(error){return {id:e.id,ok:false,error:error.name==='TimeoutError'?'TIMEOUT':'UNREACHABLE'};}
 }));
 const recordings=await Promise.all(plan.recordings.map(async r=>{
  try{const file=await statFn(r.path);return {id:r.id,exists:true,bytes:file.size,modifiedMs:file.mtimeMs};}
  catch(error){return {id:r.id,exists:false,error:error.code==='ENOENT'?'MISSING':'UNREADABLE'};}
 }));
 return {timestamp,endpoints,recordings};
}
export function evaluate(samples,plan){
 const checks=[];
 for(const endpoint of plan.endpoints){
  const readings=samples.map(s=>s.endpoints.find(e=>e.id===endpoint.id)).filter(Boolean);
  const failures=readings.filter(e=>!e.ok).length;
  const maxConsecutive=readings.reduce((a,e)=>({run:e.ok?0:a.run+1,max:Math.max(a.max,e.ok?0:a.run+1)}),{run:0,max:0}).max;
  checks.push({name:'endpoint',id:endpoint.id,status:failures?'fail':'pass',failures,samples:readings.length,maxConsecutiveFailures:maxConsecutive});
 }
 for(const recording of plan.recordings){
  const readings=samples.map(s=>s.recordings.find(r=>r.id===recording.id)).filter(Boolean);
  const present=readings.filter(r=>r.exists);
  const grace=plan.initialMissingGraceSamples??0;
  const effective=readings.slice(grace);
  const first=effective[0],last=effective.at(-1);
  const growth=first?.exists&&last?.exists?last.bytes-first.bytes:0;
  const minGrowthBytes=recording.minGrowthBytes??1;
  const status=effective.length<2||effective.some(r=>!r.exists)?'fail':growth<minGrowthBytes?'fail':'pass';
  checks.push({name:'recording-growth',id:recording.id,status,firstBytes:first?.bytes??null,lastBytes:last?.bytes??null,growthBytes:growth,minGrowthBytes});
 }
 const failures=checks.filter(c=>c.status==='fail').length;
 return {schemaVersion:1,generatedAt:new Date().toISOString(),host:process.env.COMPUTERNAME||'unknown',status:failures?'fail':'pass',summary:{status:failures?'fail':'pass',failures,total:checks.length},sampleCount:samples.length,checks,samples};
}
export async function observe(plan,{sampleFn=sample,sleep=delay}={}){
 const samples=[];
 const count=Math.ceil(plan.durationSeconds/plan.intervalSeconds)+1;
 for(let i=0;i<count;i++){
  samples.push(await sampleFn(plan));
  if(i<count-1)await sleep(plan.intervalSeconds*1000);
 }
 return evaluate(samples,plan);
}
export async function main(args=process.argv.slice(2)){
 const opts=parseArgs(args);
 if(opts.help){console.log('Usage: node tools/tournament-observer.mjs --plan tools/observer.example.json --report observer.json [--dry-run]');return 0;}
 const plan=validatePlan(JSON.parse(await readFile(opts.plan,'utf8')));
 if(opts.dryRun){console.log(JSON.stringify({valid:true,endpoints:plan.endpoints.map(e=>e.id),recordings:plan.recordings.map(r=>r.id),durationSeconds:plan.durationSeconds},null,2));return 0;}
 const result=await observe(plan);
 await mkdir(dirname(opts.report),{recursive:true});await writeFile(opts.report,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,summary:result.summary,report:opts.report},null,2));return result.status==='fail'?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(code=>process.exitCode=code).catch(e=>{console.error(e.message);process.exitCode=2;});
