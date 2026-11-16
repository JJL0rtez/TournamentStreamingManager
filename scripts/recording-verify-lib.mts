import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export type Stream={codec_type?:string;codec_name?:string;width?:number;height?:number;avg_frame_rate?:string;sample_rate?:string;channels?:number};
export type Probe={streams?:Stream[];format?:{duration?:string;size?:string;format_name?:string}};
export type Finding={code:string;level:'ok'|'warning'|'error';message:string};
export function rate(value:string|undefined){if(!value)return 0;const [a,b='1']=value.split('/').map(Number);return b>0&&Number.isFinite(a/b)?a/b:0;}
export function inspect(p:Probe,size:number,minSeconds=3):Finding[]{
 const out:Finding[]=[];const add=(code:string,level:Finding['level'],message:string)=>out.push({code,level,message});
 if(size<=0)add('empty','error','File is empty');else add('nonempty','ok',`${size} bytes`);
 const streams=p.streams||[];const videos=streams.filter(x=>x.codec_type==='video');const audios=streams.filter(x=>x.codec_type==='audio');
 if(videos.length!==1)add('video-count','error',`Expected one video stream, found ${videos.length}`);else{
 const v=videos[0];add('video-present','ok',`Video codec: ${v.codec_name||'unknown'}`);
 if(!v.width||!v.height)add('video-resolution','error','Video resolution unavailable');else add('video-resolution','ok',`${v.width}x${v.height}`);
 const fps=rate(v.avg_frame_rate);if(fps<=0)add('video-fps','warning','Frame rate not reported');else add('video-fps','ok',`${fps.toFixed(2)} fps`);
 }
 if(audios.length!==1)add('audio-count','error',`Expected one audio stream, found ${audios.length}`);else{
 const a=audios[0];add('audio-present','ok',`Audio codec: ${a.codec_name||'unknown'}`);
 if(!Number(a.sample_rate)||!a.channels)add('audio-format','warning','Audio sample rate or channels unavailable');else add('audio-format','ok',`${a.sample_rate} Hz, ${a.channels} channels`);
 }
 const duration=Number(p.format?.duration);if(!Number.isFinite(duration)||duration<=0)add('duration','error','No valid duration');else if(duration<minSeconds)add('short-duration','warning',`Recording only ${duration.toFixed(2)} seconds`);else add('duration','ok',`${duration.toFixed(2)} seconds`);
 return out;
}
export function summarize(findings:Finding[]){return {errors:findings.filter(x=>x.level==='error').length,warnings:findings.filter(x=>x.level==='warning').length,ok:findings.filter(x=>x.level==='ok').length};}
export function validateDirectory(input:string){if(!input||input.includes('\0'))throw Error('Invalid recording directory');return path.resolve(input);}
export async function findRecordings(directory:string,recursive=false,maxFiles=200){
 const results:string[]=[];async function visit(dir:string,depth:number){for(const ent of await readdir(dir,{withFileTypes:true})){if(results.length>=maxFiles)break;const full=path.join(dir,ent.name);if(ent.isSymbolicLink())continue;if(ent.isDirectory()&&recursive&&depth<3)await visit(full,depth+1);else if(ent.isFile()&&/\.(mkv|mp4)$/i.test(ent.name))results.push(full);}}
 await visit(directory,0);const withStats=await Promise.all(results.map(async file=>({file,info:await stat(file)})));return withStats.sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs);
}
