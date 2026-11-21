#!/usr/bin/env node
// Non-destructive simultaneous DirectShow capture acceptance harness, Node 20+.
// Does not alter application streams. Run only when cameras are idle.
import { spawn } from 'node:child_process';
import { readFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand, summarize } from './tournament-readiness.mjs';

export function validateConfig(raw) {
 if (!raw || !Array.isArray(raw.cameras) || raw.cameras.length<1 || raw.cameras.length>8) throw Error('Specify 1..8 cameras');
 const ids=new Set(), devices=new Set();
 const duration=raw.durationSeconds??60;
 if (!Number.isInteger(duration)||duration<10||duration>3600)throw Error('durationSeconds must be 10..3600');
 const width=raw.width??1920,height=raw.height??1080,fps=raw.fps??30;
 if (![width,height,fps].every(Number.isInteger)||width<320||width>3840||height<240||height>2160||fps<1||fps>60)throw Error('Invalid resolution or frame rate');
 const bitrate=raw.bitrateMbps??8;
 if (!Number.isFinite(bitrate)||bitrate<1||bitrate>50)throw Error('bitrateMbps must be 1..50');
 for(const cam of raw.cameras){
  if(typeof cam.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(cam.id)||ids.has(cam.id))throw Error('Camera IDs must be unique safe identifiers');
  if(typeof cam.video!=='string'||!cam.video.trim()||cam.video.length>160||/[\r\n]/.test(cam.video)||devices.has(cam.video))throw Error('Camera video devices must be unique');
  if(cam.audio!==undefined&&(typeof cam.audio!=='string'||cam.audio.length>160||/[\r\n]/.test(cam.audio)))throw Error('Invalid audio device');
  ids.add(cam.id);devices.add(cam.video);
 }
 return {durationSeconds:duration,width,height,fps,bitrateMbps:bitrate,cameras:raw.cameras};
}
export function parseArgs(argv){
 const o={config:null,output:null,report:resolve('multicam-report.json'),ffmpeg:'ffmpeg',ffprobe:'ffprobe',dryRun:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(a==='--help'){o.help=true;continue;}if(a==='--dry-run'){o.dryRun=true;continue;}
  if(!['--config','--output','--report','--ffmpeg','--ffprobe'].includes(a))throw Error(`Unknown argument: ${a}`);
  const v=argv[++i];if(!v||v.startsWith('--'))throw Error(`Missing value: ${a}`);
  o[a.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=['--config','--output','--report'].includes(a)?resolve(v):v;
 }
 if(!o.help&&(!o.config||!o.output))throw Error('--config and --output are required');
 return o;
}
export function ffmpegArgs(camera,cfg,output){
 const input=`video=${camera.video}${camera.audio?`:audio=${camera.audio}`:''}`;
 return ['-hide_banner','-nostdin','-n','-thread_queue_size','512','-f','dshow','-rtbufsize','512M','-video_size',`${cfg.width}x${cfg.height}`,'-framerate',String(cfg.fps),'-vcodec','mjpeg','-i',input,'-t',String(cfg.durationSeconds),'-map','0:v:0',...(camera.audio?['-map','0:a:0']:[]),'-c:v','h264_nvenc','-preset','p4','-b:v',`${cfg.bitrateMbps}M`,'-pix_fmt','yuv420p',...(camera.audio?['-c:a','aac','-b:a','192k']:['-an']),'-f','matroska',output];
}
export function parseFfmpegStats(log){
 const frames=[...log.matchAll(/frame=\s*(\d+)/g)].map(x=>Number(x[1]));
 const drops=[...log.matchAll(/drop=\s*(\d+)/g)].map(x=>Number(x[1]));
 const speed=[...log.matchAll(/speed=\s*([\d.]+)x/g)].map(x=>Number(x[1]));
 return {frames:frames.at(-1)??0,dropped:drops.at(-1)??null,speed:speed.at(-1)??null};
}
export function runCapture(program,args,{timeoutMs,spawnFn=spawn}={}){
 return new Promise(done=>{
  let child,log='',ended=false,timedOut=false;
  const finish=x=>{if(!ended){ended=true;clearTimeout(timer);done(x);}};
  let timer;
  try{child=spawnFn(program,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});}
  catch(e){done({ok:false,error:e.message,log:''});return;}
  timer=setTimeout(()=>{timedOut=true;
   if(process.platform==='win32' && child.pid){
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>{try{child.kill();}catch{}});
   }else{try{child.kill('SIGTERM');}catch{}}
  },timeoutMs);
  child.stderr?.on('data',chunk=>{log=(log+String(chunk)).slice(-20000);});
  child.on('error',e=>finish({ok:false,error:e.code||e.message,log}));
  child.on('close',code=>finish({ok:code===0&&!timedOut,code,error:timedOut?'TIMEOUT':undefined,log}));
 });
}
export function evaluateProbe(data,expectedDuration,{expectedFps=30,minimumFpsRatio=0.85}={}){
 const video=data.streams?.find(s=>s.codec_type==='video');
 const duration=Number(data.format?.duration);
 const frameRate=video?.avg_frame_rate?.split('/').map(Number);
 const fps=frameRate?.length===2&&frameRate[1]>0?frameRate[0]/frameRate[1]:null;
 const reasons=[];
 if(!video)reasons.push('VIDEO_STREAM_MISSING');
 if(!Number.isFinite(duration)||duration<expectedDuration*0.9)reasons.push('DURATION_TOO_SHORT');
 if(video&&(!video.width||!video.height))reasons.push('VIDEO_DIMENSIONS_MISSING');
 if(fps!==null&&fps<expectedFps*minimumFpsRatio)reasons.push('FRAME_RATE_INVALID');
 return {ok:reasons.length===0,reasons,duration:Number.isFinite(duration)?duration:null,fps};
}
export async function inspectFile(path,{command=runCommand,ffprobe='ffprobe',durationSeconds=60,expectedFps=30}={}){
 try{
  const info=await stat(path);
  if(info.size===0)return {ok:false,reasons:['EMPTY_RECORDING'],bytes:0};
  const result=await command(ffprobe,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate','-of','json',path],{timeoutMs:20000});
  if(!result.ok)return {ok:false,reasons:['FFPROBE_FAILED'],bytes:info.size};
  return {...evaluateProbe(JSON.parse(result.stdout),durationSeconds,{expectedFps}),bytes:info.size};
 }catch(e){return {ok:false,reasons:[`INSPECTION_ERROR:${e.code||e.name}`]};}
}
export async function runMulticam(options,{capture=runCapture,probe=inspectFile,platform=process.platform,now=()=>Date.now()}={}){
 const cfg=validateConfig(JSON.parse(await readFile(options.config,'utf8')));
 const output=resolve(options.output),report=resolve(options.report);
 if(output===dirname(report)||report.startsWith(output+'/')||report.startsWith(output+'\\'))throw Error('Place report outside capture output directory');
 const files=cfg.cameras.map(cam=>({cam,path:join(output,`${cam.id}.mkv`)}));
 if(options.dryRun)return {dryRun:true,commands:files.map(({cam,path})=>({cameraId:cam.id,program:options.ffmpeg,args:ffmpegArgs(cam,cfg,path)}))};
 if(platform!=='win32')throw Error('Live DirectShow test requires Windows');
 await mkdir(output,{recursive:true});
 const existing=new Set(await readdir(output));
 for(const {path} of files)if(existing.has(basename(path)))throw Error(`Refusing to overwrite existing recording: ${basename(path)}`);
 const start=now();
 // Launch all captures without awaiting individual completion. This tests concurrent USB + NVENC + disk load.
 const runs=files.map(async ({cam,path})=>({cameraId:cam.id,path,...await capture(options.ffmpeg,ffmpegArgs(cam,cfg,path),{timeoutMs:(cfg.durationSeconds+45)*1000})}));
 const completed=await Promise.all(runs);
 const results=await Promise.all(completed.map(async result=>{
  const media=await probe(result.path,{ffprobe:options.ffprobe,durationSeconds:cfg.durationSeconds,expectedFps:cfg.fps});
  const stats=parseFfmpegStats(result.log||'');
  const expectedFrames=cfg.fps*cfg.durationSeconds;
  const reasons=[...(result.ok?[]:[result.error||`FFMPEG_EXIT_${result.code}`]),...(stats.frames<expectedFrames*0.85?['LOW_CAPTURE_FRAME_COUNT']:[]),...(media.reasons||[])];
  return {cameraId:result.cameraId,status:reasons.length?'fail':'pass',reasons,frames:stats.frames,expectedFrames,dropCount:stats.dropped,speed:stats.speed,media,output:result.path};
 }));
 const checks=results.map(r=>({name:'simultaneous-camera-recording',status:r.status,detail:`${r.cameraId}: ${r.reasons.join(', ')||'validated'}`}));
 return {schemaVersion:1,generatedAt:new Date().toISOString(),host:process.env.COMPUTERNAME||'unknown',durationSeconds:cfg.durationSeconds,wallSeconds:(now()-start)/1000,summary:summarize(checks),cameras:results,checks};
}
export async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);
 if(options.help){console.log('Usage: node tools/tournament-multicam.mjs --config tools/multicam.example.json --output D:\\TournamentTest --report multicam-report.json [--dry-run]');return 0;}
 const result=await runMulticam(options);
 if(!result.dryRun){await mkdir(dirname(options.report),{recursive:true});await writeFile(options.report,JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result,null,2));return result.dryRun?0:result.summary.status==='fail'?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().then(code=>process.exitCode=code).catch(e=>{console.error(e.message);process.exitCode=2;});
