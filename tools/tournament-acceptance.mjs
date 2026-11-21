#!/usr/bin/env node
// Consolidates readiness, stress and simultaneous recording reports across PCs.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function parseArgs(args){const opts={inputs:[],output:resolve('tournament-acceptance.json'),expectedCameras:8};for(let i=0;i<args.length;i++){const key=args[i];if(key==='--help'){opts.help=true;continue;}if(!['--input','--output','--expected-cameras'].includes(key))throw Error(`Unknown option ${key}`);const val=args[++i];if(!val||val.startsWith('--'))throw Error(`Missing ${key}`);if(key==='--input')opts.inputs.push(resolve(val));if(key==='--output')opts.output=resolve(val);if(key==='--expected-cameras')opts.expectedCameras=Number(val);}if(!opts.help&&opts.inputs.length===0)throw Error('Provide at least one --input');if(!Number.isInteger(opts.expectedCameras)||opts.expectedCameras<1||opts.expectedCameras>8)throw Error('expected-cameras must be 1..8');return opts;}
export function summarizeAcceptance(reports,{expectedCameras=8}={}){
 const checks=[];const hosts=new Map();const ids=new Set();let tested=0;
 for(const [i,r] of reports.entries()){
  if(!r||typeof r!=='object'||!r.summary) {checks.push({status:'fail',detail:`report ${i+1}: invalid report`});continue;}
  const host=String(r.host||'unknown');
  const key=`${host}:${r.cameras?'multicam':r.sampleCount!==undefined?'observer':r.checks?.some(c=>c.name==='sustained-disk-write')?'stress':'readiness'}`;
  if(hosts.has(key))checks.push({status:'warn',detail:`Multiple reports for ${key}`});
  hosts.set(key,true);
  if(r.sampleCount!==undefined && r.sampleCount<2)checks.push({status:'fail',detail:`${key}: insufficient monitoring samples`});
  if(r.summary.status==='fail')checks.push({status:'fail',detail:`${key}: checks failed`});
  else if(r.summary.status==='warn')checks.push({status:'warn',detail:`${key}: warnings present`});
  else checks.push({status:'pass',detail:`${key}: passed`});
  if(Array.isArray(r.cameras))for(const cam of r.cameras){
   if(!cam||typeof cam.cameraId!=='string'){checks.push({status:'fail',detail:`${key}: invalid camera result`});continue;}
   if(ids.has(cam.cameraId))checks.push({status:'fail',detail:`Camera ID ${cam.cameraId} appears more than once`});
   ids.add(cam.cameraId);tested++;
   if(cam.status!=='pass')checks.push({status:'fail',detail:`${host}/${cam.cameraId}: recording test failed`});
   if(cam.media?.duration!==undefined && Number.isFinite(Number(cam.media.duration)) && Number(cam.media.duration)<10)checks.push({status:'fail',detail:`${host}/${cam.cameraId}: recording too short`});
  }
 }
 if(tested<expectedCameras)checks.push({status:'fail',detail:`Only ${tested}/${expectedCameras} camera recording tests supplied`});
 if(tested>expectedCameras)checks.push({status:'warn',detail:`${tested} camera tests supplied; expected ${expectedCameras}`});
 const failures=checks.filter(c=>c.status==='fail').length,warnings=checks.filter(c=>c.status==='warn').length;
 return {schemaVersion:1,generatedAt:new Date().toISOString(),status:failures?'fail':warnings?'warn':'pass',expectedCameras,testedCameras:tested,failures,warnings,checks};
}
export async function main(args=process.argv.slice(2)){
 const opts=parseArgs(args);if(opts.help){console.log('Usage: node tools/tournament-acceptance.mjs --input pc1-readiness.json --input pc1-stress.json --input pc1-multicam.json [--input pc2-multicam.json] --expected-cameras 8 --output acceptance.json');return 0;}
 const reports=await Promise.all(opts.inputs.map(async p=>JSON.parse(await readFile(p,'utf8'))));const result=summarizeAcceptance(reports,opts);
 await writeFile(opts.output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));return result.status==='fail'?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(code=>process.exitCode=code).catch(e=>{console.error(e.message);process.exitCode=2;});
