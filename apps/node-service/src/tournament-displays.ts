import type {Express} from "express";
import {mkdir,readFile,writeFile,rename} from "node:fs/promises";
import path from "node:path";
const file=path.resolve(process.cwd(),"data","tournament-displays.json");
const defaults={revision:0,slides:[] as unknown[],rotation:{enabled:false,cameraSeconds:20,motionThreshold:12,sponsorEvery:0,sponsorVideos:[] as string[],blacklist:[] as string[]}};
let serial:Promise<unknown>=Promise.resolve();
function validate(raw:any){
 if(!raw||!Array.isArray(raw.slides)||raw.slides.length>100)throw Error("Invalid slides");
 const slides=raw.slides.map((s:any)=>{
  if(!s||typeof s.id!=="string"||s.id.length>100||typeof s.title!=="string"||s.title.length>120||!Number.isInteger(s.duration)||s.duration<3||s.duration>3600||!["schedule","announcement","sponsor"].includes(s.kind))throw Error("Invalid slide");
  if(!Array.isArray(s.tables)||s.tables.length>12)throw Error("Invalid tables");
  const tables=s.tables.map((t:any)=>{if(typeof t.heading!=="string"||t.heading.length>100||typeof t.subheading!=="string"||t.subheading.length>120||!Array.isArray(t.rows)||t.rows.length>60)throw Error("Invalid table");return {heading:t.heading,subheading:t.subheading,row:Number.isInteger(t.row)?Math.max(0,Math.min(11,t.row)):undefined,column:t.column===0||t.column===1?t.column:undefined,rowSpan:Number.isInteger(t.rowSpan)?Math.max(1,Math.min(3,t.rowSpan)):1,rows:t.rows.map((r:any)=>{if(typeof r.event!=="string"||r.event.length>160||typeof r.time!=="string"||r.time.length>40)throw Error("Invalid row");return {event:r.event,time:r.time};})};});
  return {id:s.id,title:s.title,duration:s.duration,kind:s.kind,tables,body:typeof s.body==="string"?s.body.slice(0,1000):""};
 });
 const r=raw.rotation;if(!r||typeof r!=="object")throw Error("Invalid rotation");
 if(typeof r.enabled!=="boolean"||!Number.isInteger(r.cameraSeconds)||r.cameraSeconds<5||r.cameraSeconds>300||!Number.isFinite(r.motionThreshold)||r.motionThreshold<1||r.motionThreshold>100||!Number.isInteger(r.sponsorEvery)||r.sponsorEvery<0||r.sponsorEvery>30)throw Error("Invalid rotation options");
 if(!Array.isArray(r.blacklist)||r.blacklist.length>32||r.blacklist.some((x:any)=>typeof x!=="string"||x.length>500))throw Error("Invalid blacklist");
 if(!Array.isArray(r.sponsorVideos)||r.sponsorVideos.length>20||r.sponsorVideos.some((x:any)=>typeof x!=="string"||x.length>1000||!(x.startsWith("https://")||x.startsWith("/api/"))))throw Error("Invalid sponsor videos");
 const b=raw.branding;
 const safeLogo=(u:any)=>typeof u==="string"&&u.length<=1000&&(!u||(/^https:\/\/[^\s]+$/.test(u)||/^\/api\/billboard\/assets\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(u)))?u:"";
 const branding=b&&typeof b==="object"?{lines:Array.isArray(b.lines)?b.lines.slice(0,6).map((l:any)=>({text:String(l?.text||"").slice(0,120),color:/^#[a-fA-F0-9]{6}$/.test(l?.color)?l.color:"#ffffff"})):[],leftLogos:Array.isArray(b.leftLogos)?b.leftLogos.slice(0,6).map(safeLogo):[],titleLeftLogo:safeLogo(b.titleLeftLogo),titleRightLogo:safeLogo(b.titleRightLogo),logoSettings:Object.fromEntries(Object.entries(b.logoSettings&&typeof b.logoSettings==="object"?b.logoSettings:{}).filter(([key])=>/^(title-left|title-right|left-[0-5])$/.test(key)).map(([key,val])=>{const v=val as any;const clamp=(n:any,lo:number,hi:number,def:number)=>Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):def;return [key,{width:clamp(v?.width,30,400,110),offsetX:clamp(v?.offsetX,-500,500,0),offsetY:clamp(v?.offsetY,-500,500,0)}];}))}:undefined;
 return {slides,branding,rotation:{enabled:r.enabled,cameraSeconds:r.cameraSeconds,motionThreshold:r.motionThreshold,sponsorEvery:r.sponsorEvery,sponsorVideos:r.sponsorVideos,blacklist:r.blacklist}};
}
async function load(){try{const data=JSON.parse(await readFile(file,"utf8"));return {revision:data.revision||0,...validate(data)};}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return defaults;throw e;}}
export function installTournamentDisplays(app:Express){
 app.get("/api/tournament-displays",async(_req,res)=>{res.setHeader("Cache-Control","no-store");try{res.json(await load());}catch(e){res.status(500).json({error:String(e)});}});
 app.put("/api/tournament-displays",async(req,res)=>{const work=async()=>{try{const current=await load();if(req.body?.revision!==current.revision){res.status(409).json(current);return;}const next={revision:current.revision+1,...validate(req.body)};await mkdir(path.dirname(file),{recursive:true});const temp=file+"."+process.pid+".tmp";await writeFile(temp,JSON.stringify(next,null,2));await rename(temp,file);res.setHeader("Cache-Control","no-store");res.json(next);}catch(e){res.status(400).json({error:String(e)});}};serial=serial.then(work,work);await serial;});
}
