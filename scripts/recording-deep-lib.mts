import {spawn} from 'node:child_process';
import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export type Finding={code:string;level:'ok'|'warning'|'error';message:string};
export type Metrics={file:string;bytes:number;duration:number|null;videoFrames:number|null;audioRmsDb:number|null;audioPeakDb:number|null;blackSeconds:number;freezeSeconds:number;silenceSeconds:number;decodeErrors:number;exitCode:number|null;timedOut:boolean;findings:Finding[]};
export function parseDuration(s:string){const m=s.match(/(?:^|[^\d])(\d\d):(\d\d):(\d\d(?:\.\d+)?)/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):null;}
export function parseDb(s:string,label:string){const m=s.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*:\\s*(-?(?:\\d+(?:\\.\\d+)?|inf))','i'));return m?(m[1].toLowerCase()==='-inf'?-Infinity:Number(m[1])):null;}
export function parseFilterLog(log:string){
 const black=[...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].reduce((s,m)=>s+Number(m[3]),0);
 const freeze=[...log.matchAll(/freeze_start:([\d.]+).*?freeze_end:([\d.]+).*?freeze_duration:([\d.]+)/g)].reduce((s,m)=>s+Number(m[3]),0);
 const silence=[...log.matchAll(/silence_end:\s*[\d.]+\s*\|\s*silence_duration:\s*([\d.]+)/g)].reduce((s,m)=>s+Number(m[1]),0);
 const frames=[...log.matchAll(/frame=\s*(\d+)/g)].map(m=>Number(m[1]));
 return {blackSeconds:black,freezeSeconds:freeze,silenceSeconds:silence,videoFrames:frames.length?Math.max(...frames):null,audioRmsDb:parseDb(log,'RMS level dB')??parseDb(log,'mean_volume'),audioPeakDb:parseDb(log,'Peak level dB')??parseDb(log,'max_volume')};
}
export function assess(m:Omit<Metrics,'findings'>,opts:{minSeconds:number;maxBlackRatio:number;maxFreezeRatio:number;maxSilenceRatio:number;silenceDb:number}):Finding[]{
 const f:Finding[]=[];const add=(code:string,level:Finding['level'],message:string)=>f.push({code,level,message});
 if(m.timedOut)add('timeout','error','Decode exceeded time limit');
 if(m.exitCode!==0)add('decode','error',`FFmpeg decode exit code ${m.exitCode}`);
 else add('decode','ok','FFmpeg decoded recording successfully');
 if(m.videoFrames===null)add('video-frames','warning','No decoded frame count available');
 else if(m.videoFrames===0)add('video-frames','error','No decoded video frames');
 else add('video-frames','ok',`${m.videoFrames} decoded video frames`);
 if(m.audioRmsDb===null)add('audio-level','warning','Audio level unavailable, check that audio stream exists');
 else if(!Number.isFinite(m.audioRmsDb)||m.audioRmsDb<=opts.silenceDb)add('audio-level','warning',`Audio RMS ${m.audioRmsDb} dBFS; possibly silent`);
 else add('audio-level','ok',`Audio RMS ${m.audioRmsDb} dBFS`);
 if(m.duration!==null&&m.duration<opts.minSeconds)add('short-duration','warning',`Only ${m.duration.toFixed(2)} seconds`);
 for(const [code,seconds,max] of [['black',m.blackSeconds,opts.maxBlackRatio],['freeze',m.freezeSeconds,opts.maxFreezeRatio],['silence',m.silenceSeconds,opts.maxSilenceRatio]] as const){
   if(m.duration===null||m.duration<=0){add(code,'warning',`Cannot assess ${code} ratio without duration`);continue;}
   const ratio=seconds/m.duration;add(code,ratio>max?'warning':'ok',`${seconds.toFixed(2)} seconds (${(ratio*100).toFixed(1)}%)`);
 }
 return f;
}
export function validateArgs(n:number,limit:number,timeout:number){if(!Number.isInteger(n)||n<1||n>8)throw Error('Concurrency must be 1..8');if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Limit must be 1..200');if(!Number.isFinite(timeout)||timeout<5||timeout>3600)throw Error('Timeout must be 5..3600 seconds');}
export async function listRecordings(dir:string,recursive:boolean,limit:number){
 const found:{file:string;bytes:number;mtime:number}[]=[];
 async function walk(p:string,depth:number){for(const e of await readdir(p,{withFileTypes:true})){if(e.isSymbolicLink())continue;const f=path.join(p,e.name);if(e.isDirectory()&&recursive&&depth<4)await walk(f,depth+1);else if(e.isFile()&&/\.(mkv|mp4)$/i.test(e.name)){const s=await stat(f);found.push({file:f,bytes:s.size,mtime:s.mtimeMs});}}}
 await walk(path.resolve(dir),0);return found.sort((a,b)=>b.mtime-a.mtime).slice(0,limit);
}
export function run(command:string,args:string[],timeoutMs:number):Promise<{code:number|null;stderr:string;timedOut:boolean}>{
 return new Promise((resolve,reject)=>{const p=spawn(command,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';let timedOut=false;const t=setTimeout(()=>{timedOut=true;p.kill('SIGKILL');},timeoutMs);p.stderr.on('data',(d:Buffer)=>{stderr+=d.toString();if(stderr.length>2_000_000)stderr=stderr.slice(-1_500_000);});p.on('error',e=>{clearTimeout(t);reject(e);});p.on('close',code=>{clearTimeout(t);resolve({code,stderr,timedOut});});});
}
export async function probeDuration(ffprobe:string,file:string){const r=await new Promise<string>((resolve,reject)=>{const p=spawn(ffprobe,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{windowsHide:true});let out='';p.stdout.on('data',(b:Buffer)=>out+=b.toString());p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(Error(`ffprobe exit ${c}`)));});const n=Number(r.trim());return Number.isFinite(n)&&n>0?n:null;}
export async function analyze(file:string,bytes:number,config:{ffmpeg:string;ffprobe:string;timeout:number;minSeconds:number;maxBlackRatio:number;maxFreezeRatio:number;maxSilenceRatio:number;silenceDb:number}):Promise<Metrics>{
 const duration=await probeDuration(config.ffprobe,file);
 // Decode each media stream independently to avoid filtergraph stream-mapping ambiguity.
 const v=await run(config.ffmpeg,['-hide_banner','-nostdin','-loglevel','info','-i',file,'-map','0:v:0','-vf','blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-50dB:d=2','-an','-f','null','-'],config.timeout*1000);
 const a=await run(config.ffmpeg,['-hide_banner','-nostdin','-loglevel','info','-i',file,'-map','0:a:0','-vn','-af','silencedetect=noise=-45dB:d=1,volumedetect','-f','null','-'],config.timeout*1000);
 const parsed=parseFilterLog(v.stderr+'\n'+a.stderr);
 const base={file,bytes,duration,...parsed,decodeErrors:Number(v.code!==0)+Number(a.code!==0),exitCode:v.code===0&&a.code===0?0:(v.code!==0?v.code:a.code),timedOut:v.timedOut||a.timedOut};
 return {...base,findings:assess(base,config)};
}
export async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{let next=0;const out:R[]=Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));return out;}
