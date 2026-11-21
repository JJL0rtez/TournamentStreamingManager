#!/usr/bin/env node
// Non-destructive tournament host stress checks. Node 20+.
import { open, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { runCommand, summarize } from './tournament-readiness.mjs';

const MiB = 1024 * 1024;
const check = (name,status,detail,extra={}) => ({name,status,detail,...extra});
export function parseStressArgs(args) {
 const options={directory:resolve(tmpdir()),sizeMiB:256,minMiBps:25,cameras:[],durationSeconds:8,report:resolve('stress-report.json'),listDevices:false};
 for(let i=0;i<args.length;i++) {
  const key=args[i];
  if(key==='--help'){options.help=true;continue;}
  if(key==='--list-devices'){options.listDevices=true;continue;}
  if(!['--directory','--size-mib','--min-mibps','--camera','--duration-seconds','--report'].includes(key))throw Error(`Unknown argument: ${key}`);
  const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Missing value for ${key}`);
  if(key==='--directory')options.directory=resolve(value);
  if(key==='--size-mib')options.sizeMiB=Number(value);
  if(key==='--min-mibps')options.minMiBps=Number(value);
  if(key==='--camera')options.cameras.push(value);
  if(key==='--duration-seconds')options.durationSeconds=Number(value);
  if(key==='--report')options.report=resolve(value);
 }
 if(!Number.isSafeInteger(options.sizeMiB)||options.sizeMiB<16||options.sizeMiB>4096)throw Error('size-mib must be 16..4096');
 if(!Number.isFinite(options.minMiBps)||options.minMiBps<0||options.minMiBps>10000)throw Error('min-mibps must be 0..10000');
 if(!Number.isSafeInteger(options.durationSeconds)||options.durationSeconds<3||options.durationSeconds>60)throw Error('duration-seconds must be 3..60');
 if(options.cameras.length>8||options.cameras.some(x=>x.length>150||/[\r\n]/.test(x)))throw Error('Maximum eight valid camera names');
 return options;
}
export async function benchmarkDisk(directory,{sizeMiB=256,minMiBps=25,clock=()=>performance.now(),fileFactory=open}={}) {
 const checks=[];let scratch;let file;
 try {
  scratch=await mkdtemp(join(resolve(directory),'.tsm-stress-'));
  file=await fileFactory(join(scratch,'throughput.bin'),'wx');
  const block=Buffer.alloc(MiB,0x5a);const started=clock();
  for(let i=0;i<sizeMiB;i++) {let offset=0;while(offset<block.length){const {bytesWritten}=await file.write(block,offset,block.length-offset);if(bytesWritten<=0)throw Error('WRITE_ZERO_BYTES');offset+=bytesWritten;}}
  await file.sync();const seconds=Math.max((clock()-started)/1000,0.001);
  const mibps=sizeMiB/seconds;
  checks.push(check('sustained-disk-write',mibps>=minMiBps?'pass':'fail',`${mibps.toFixed(1)} MiB/s (includes flush, ${sizeMiB} MiB)`,{mibps:Number(mibps.toFixed(2)),sizeMiB,seconds:Number(seconds.toFixed(2))}));
 } catch(e){checks.push(check('sustained-disk-write','fail',`Benchmark failed: ${e.code||e.message}`));}
 finally {if(file)try{await file.close();}catch{}if(scratch)try{await rm(scratch,{recursive:true,force:true});}catch(e){checks.push(check('benchmark-cleanup','fail',`Could not remove scratch data: ${e.code||e.message}`));}}
 return checks;
}
export function parseDshowDevices(output) {
 const lines=output.split(/\r?\n/);const devices=[];let section='';
 for(const line of lines){if(/DirectShow video devices/i.test(line))section='video';else if(/DirectShow audio devices/i.test(line))section='audio';else if(/Alternative name/i.test(line))continue;else if(section){const match=line.match(/\]\s+"([^"]+)"\s*$/);if(match)devices.push({kind:section,name:match[1]});}}
 return devices;
}
export async function inspectCameras({cameras=[],durationSeconds=8,listDevices=false,command=runCommand,platform=process.platform}={}) {
 const checks=[];
 if(!listDevices&&!cameras.length)return checks;
 if(platform!=='win32'){checks.push(check('camera-platform','warn','DirectShow camera checks require Windows'));return checks;}
 const listing=await command('ffmpeg',['-hide_banner','-list_devices','true','-f','dshow','-i','dummy'],{timeoutMs:15000});
 // FFmpeg normally exits nonzero after listing DirectShow devices.
 const devices=parseDshowDevices(`${listing.stderr||''}\n${listing.stdout||''}`);
 if(listDevices)checks.push(check('dshow-enumeration',devices.some(x=>x.kind==='video')?'pass':'fail',`${devices.filter(x=>x.kind==='video').length} video devices, ${devices.filter(x=>x.kind==='audio').length} audio devices`,{devices}));
 for(const camera of cameras){
  if(!devices.some(x=>x.kind==='video'&&x.name===camera)){checks.push(check('camera-capture','fail',`${camera}: not found in DirectShow enumeration`));continue;}
  const probe=await command('ffmpeg',['-hide_banner','-nostdin','-f','dshow','-i',`video=${camera}`,'-t',String(durationSeconds),'-an','-f','null','NUL'],{timeoutMs:(durationSeconds+15)*1000});
  const log=`${probe.stderr||''}\n${probe.stdout||''}`;
  const frames=[...log.matchAll(/frame=\s*(\d+)/g)].map(x=>Number(x[1]));const count=frames.at(-1)||0;
  checks.push(check('camera-capture',probe.ok&&count>0?'pass':'fail',`${camera}: ${count} frames, ${probe.ok?'completed':'failed or timed out'}`,{camera,frames:count}));
 }
 return checks;
}
export async function runStress(options,deps={}) {
 const checks=[...await benchmarkDisk(options.directory,{sizeMiB:options.sizeMiB,minMiBps:options.minMiBps,...(deps.disk||{})}),...await inspectCameras({cameras:options.cameras,durationSeconds:options.durationSeconds,listDevices:options.listDevices,...(deps.camera||{})})];
 return {schemaVersion:1,generatedAt:new Date().toISOString(),host:process.env.COMPUTERNAME||'unknown',summary:summarize(checks),checks};
}
export async function main(argv=process.argv.slice(2)) {
 const opts=parseStressArgs(argv);
 if(opts.help){console.log('Usage: node tools/tournament-stress.mjs --directory D:\\Recordings [--size-mib 256] [--min-mibps 25] [--list-devices] [--camera "Camera Name"] [--duration-seconds 8] [--report stress-report.json]');return 0;}
 const result=await runStress(opts);
 await writeFile(opts.report,JSON.stringify(result,null,2)+'\n',{flag:'w'});
 console.log(JSON.stringify(result,null,2));return result.summary.status==='fail'?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=2;});}
