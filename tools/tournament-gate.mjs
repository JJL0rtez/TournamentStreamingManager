#!/usr/bin/env node
// Strict tournament readiness gate. Read-only, no camera/stream mutations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const kinds=['readiness','stress','multicam','observer'];
export function validateManifest(m){
 if(!m||!Array.isArray(m.hosts)||m.hosts.length<1||m.hosts.length>8)throw Error('hosts must contain 1..8 entries');
 if(!Number.isInteger(m.expectedCameras)||m.expectedCameras<1||m.expectedCameras>8)throw Error('expectedCameras must be 1..8');
 const ids=new Set(), cameras=new Set();
 for(const h of m.hosts){
  if(!h||typeof h.id!=='string'||!h.id||ids.has(h.id))throw Error('Duplicate/invalid host id');ids.add(h.id);
  if(!Array.isArray(h.cameraIds)||h.cameraIds.length===0)throw Error('Host cameraIds required');
  for(const id of h.cameraIds){if(typeof id!=='string'||!id||cameras.has(id))throw Error('Duplicate/invalid camera assignment');cameras.add(id);}
  for(const k of kinds)if(typeof h[k]!=='string'||!h[k])throw Error(`Missing ${k} report path for ${h.id}`);
 }
 if(cameras.size!==m.expectedCameras)throw Error(`Assignments ${cameras.size} != expectedCameras ${m.expectedCameras}`);
 const maxAgeMinutes=m.maxAgeMinutes??180;
 if(!Number.isInteger(maxAgeMinutes)||maxAgeMinutes<1||maxAgeMinutes>10080)throw Error('maxAgeMinutes must be 1..10080');
 return {...m,maxAgeMinutes};
}
export async function loadReports(manifest,{read=readFile,base=process.cwd()}={}){
 const result=[];
 for(const h of manifest.hosts){const reports={};for(const k of kinds){const p=resolve(base,h[k]);reports[k]=JSON.parse(await read(p,'utf8'));}result.push({id:h.id,cameraIds:h.cameraIds,reports});}
 return result;
}
export function evaluateGate(manifest,hosts,{now=Date.now()}={}){
 const checks=[],cameraIds=new Set();
 const add=(status,host,code,detail)=>checks.push({status,host,code,detail});
 for(const h of hosts){
  for(const kind of kinds){
   const r=h.reports?.[kind];
   if(!r||typeof r!=='object'){add('fail',h.id,'MISSING_REPORT',kind);continue;}
   const stamp=Date.parse(r.generatedAt);
   if(!Number.isFinite(stamp)||stamp>now+60000||now-stamp>manifest.maxAgeMinutes*60000)add('fail',h.id,'STALE_REPORT',kind);
   if(r.host&&r.host!=='unknown'&&r.host!==h.id)add('fail',h.id,'HOST_MISMATCH',`${kind}: ${r.host}`);
   if(r.status==='fail'||r.summary?.status==='fail')add('fail',h.id,'REPORT_FAILED',kind);
   else if(r.status==='warn'||r.summary?.status==='warn')add('warn',h.id,'REPORT_WARNING',kind);
   else if(r.status!=='pass'&&r.summary?.status!=='pass')add('fail',h.id,'REPORT_STATUS_UNKNOWN',kind);
   if(kind==='observer'){
    if(!Number.isInteger(r.sampleCount)||r.sampleCount<2)add('fail',h.id,'OBSERVER_TOO_SHORT','Requires at least 2 samples');
    for(const c of r.checks??[])if(c.status==='fail')add('fail',h.id,'OBSERVER_FAILURE',c.id??c.name);
   }
  }
  const r=h.reports?.multicam;
  if(r){
   const expected=new Set(h.cameraIds),actual=new Set();
   for(const c of r.cameras??[]){
    if(!c||typeof c.cameraId!=='string'||actual.has(c.cameraId)){add('fail',h.id,'DUPLICATE_CAMERA_RESULT',String(c?.cameraId));continue;}
    actual.add(c.cameraId);cameraIds.add(c.cameraId);
    if(!expected.has(c.cameraId))add('fail',h.id,'UNEXPECTED_CAMERA',c.cameraId);
    if(c.status!=='pass')add('fail',h.id,'CAMERA_FAILED',c.cameraId);
    if(c.media?.duration!==undefined&&Number(c.media.duration)<10)add('fail',h.id,'SHORT_RECORDING',c.cameraId);
   }
   for(const id of expected)if(!actual.has(id))add('fail',h.id,'MISSING_CAMERA',id);
  }
 }
 if(cameraIds.size!==manifest.expectedCameras)add('fail','all','CAMERA_COUNT',`${cameraIds.size}/${manifest.expectedCameras}`);
 const failures=checks.filter(c=>c.status==='fail').length,warnings=checks.filter(c=>c.status==='warn').length;
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),status:failures?'fail':warnings?'warn':'pass',expectedCameras:manifest.expectedCameras,observedCameras:cameraIds.size,failures,warnings,checks};
}
export async function main(args=process.argv.slice(2)){
 let manifestPath,output='tournament-gate.json';
 for(let i=0;i<args.length;i++){if(args[i]==='--manifest')manifestPath=args[++i];else if(args[i]==='--output')output=args[++i];else if(args[i]==='--help'){console.log('node tools/tournament-gate.mjs --manifest tools/gate.example.json --output gate.json');return 0;}else throw Error(`Unknown argument ${args[i]}`);}
 if(!manifestPath)throw Error('--manifest required');
 const manifest=validateManifest(JSON.parse(await readFile(manifestPath,'utf8')));
 const hosts=await loadReports(manifest,{base:dirname(resolve(manifestPath))});
 const result=evaluateGate(manifest,hosts);
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,failures:result.failures,warnings:result.warnings,output},null,2));return result.status==='pass'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(c=>process.exitCode=c).catch(e=>{console.error(e.message);process.exitCode=2;});
