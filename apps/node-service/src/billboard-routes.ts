import express, {type Express} from "express";
import {randomUUID} from "node:crypto";
import {readFile,writeFile,mkdir,rename,readdir,unlink,stat} from "node:fs/promises";
import path from "node:path";
type Slide={id:string;title:string;body:string;duration:number;kind:"announcement"|"sponsor"|"schedule";imageUrl?:string;theme?:"default"|"blue"|"gold"|"dark"};
type Board={slides:Slide[];updatedAt:number};
const file=path.resolve(process.cwd(),"data","billboard.json");
const presetsFile=path.resolve(process.cwd(),"data","billboard-presets.json");
const assetDir=path.resolve(process.cwd(),"data","billboard-assets");
const assetPattern=/^\/api\/billboard\/assets\/([a-f0-9-]{36})\.(png|jpg|webp)$/;
const defaults:Board={slides:[{id:"welcome",title:"Welcome",body:"Tournament information will appear here.",duration:12,kind:"announcement"}],updatedAt:0};
let queue:Promise<unknown>=Promise.resolve();
function normalize(input:unknown):Board{
 if(!input||typeof input!=="object")throw Error("Invalid board");
 const raw=input as Record<string,unknown>;
 if(!Array.isArray(raw.slides)||raw.slides.length>100)throw Error("Slides must be an array of at most 100 items");
 const slides:Slide[]=raw.slides.map((x:unknown,i:number)=>{
  if(!x||typeof x!=="object")throw Error(`Invalid slide ${i}`);
  const s=x as Record<string,unknown>;
  if(typeof s.id!=="string"||s.id.length<1||s.id.length>100||typeof s.title!=="string"||s.title.length>100||typeof s.body!=="string"||s.body.length>400)throw Error(`Invalid slide text ${i}`);
  if(!["announcement","sponsor","schedule"].includes(String(s.kind)))throw Error(`Invalid slide kind ${i}`);
  if(!Number.isInteger(s.duration)||Number(s.duration)<3||Number(s.duration)>120)throw Error(`Invalid duration ${i}`);
  if(s.imageUrl!==undefined){if(typeof s.imageUrl!=="string"||s.imageUrl.length>1000)throw Error(`Invalid image URL ${i}`);if(s.imageUrl && !assetPattern.test(s.imageUrl)){let parsed:URL;try{parsed=new URL(s.imageUrl);}catch{throw Error(`Invalid image URL ${i}`);}if((parsed.protocol!=="https:"||parsed.username||parsed.password) && !assetPattern.test(s.imageUrl))throw Error(`Image URL must use HTTPS ${i}`);}}
  if(s.theme!==undefined&&!["default","blue","gold","dark"].includes(String(s.theme)))throw Error(`Invalid theme ${i}`);
  return {id:s.id,title:s.title,body:s.body,duration:Number(s.duration),kind:s.kind as Slide["kind"],imageUrl:s.imageUrl as string|undefined,theme:s.theme as Slide["theme"]};
 });
 if(new Set(slides.map(s=>s.id)).size!==slides.length)throw Error("Duplicate slide IDs");
 return {slides,updatedAt:Date.now()};
}
async function read(){try{const x=JSON.parse(await readFile(file,"utf8"));return {board:normalize(x.board),revision:Number(x.revision)||0};}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {board:defaults,revision:0};throw e;}}
function imageType(bytes:Buffer):{ext:string;mime:string}|null{
 if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext:"png",mime:"image/png"};
 if(bytes.length>=3 && bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {ext:"jpg",mime:"image/jpeg"};
 if(bytes.length>=12&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP")return {ext:"webp",mime:"image/webp"};
 return null;
}
type Preset={id:string;name:string;board:Board;layout:"classic"|"split"|"minimal";showClock:boolean;createdAt:string};
let presetQueue:Promise<unknown>=Promise.resolve();
async function getPresets():Promise<Preset[]>{try{const raw=JSON.parse(await readFile(presetsFile,"utf8"));if(!Array.isArray(raw))throw Error("Invalid preset store");return raw as Preset[];}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}}
async function storePresets(items:Preset[]){await mkdir(path.dirname(presetsFile),{recursive:true});const tmp=`${presetsFile}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(items,null,2),"utf8");await rename(tmp,presetsFile);}
export function installBillboardRoutes(app:Express){
 app.get("/api/billboard/presets",async(_req,res)=>{try{res.setHeader("Cache-Control","no-store");const presets=await getPresets();res.json({presets:presets.map(({id,name,layout,showClock,createdAt})=>({id,name,layout,showClock,createdAt}))});}catch(e){res.status(500).json({error:String(e)});}});
 app.get("/api/billboard/presets/:id",async(req,res)=>{try{const preset=(await getPresets()).find(x=>x.id===req.params.id);if(!preset){res.status(404).json({error:"Preset not found"});return;}res.setHeader("Cache-Control","no-store");res.json({preset});}catch(e){res.status(500).json({error:String(e)});}});
 app.post("/api/billboard/presets",async(req,res)=>{const task=async()=>{try{const name=req.body?.name;if(typeof name!=="string"||!name.trim()||name.length>80){res.status(400).json({error:"Preset name must be 1-80 characters"});return;}const board=normalize(req.body?.board);const layout=req.body?.layout;if(!["classic","split","minimal"].includes(layout)||typeof req.body?.showClock!=="boolean"){res.status(400).json({error:"Invalid display settings"});return;}const presets=await getPresets();if(presets.length>=50){res.status(409).json({error:"Maximum 50 presets"});return;}const preset:Preset={id:randomUUID(),name:name.trim(),board,layout,showClock:req.body.showClock,createdAt:new Date().toISOString()};await storePresets([...presets,preset]);res.status(201).json({preset});}catch(e){res.status(400).json({error:String(e)});}};presetQueue=presetQueue.then(task,task);await presetQueue;});
 app.delete("/api/billboard/presets/:id",async(req,res)=>{const task=async()=>{try{const presets=await getPresets();const next=presets.filter(x=>x.id!==req.params.id);if(next.length===presets.length){res.status(404).json({error:"Preset not found"});return;}await storePresets(next);res.json({deleted:true});}catch(e){res.status(500).json({error:String(e)});}};presetQueue=presetQueue.then(task,task);await presetQueue;});
 app.get("/api/billboard/assets",async(_req,res)=>{try{const files=await readdir(assetDir).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return [];throw e;});const result=await Promise.all(files.filter(x=>/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(x)).map(async name=>({name,url:`/api/billboard/assets/${name}`,bytes:(await stat(path.join(assetDir,name))).size})));res.setHeader("Cache-Control","no-store");res.json({assets:result});}catch(e){res.status(500).json({error:String(e)});}});
 app.post("/api/billboard/assets",express.raw({type:["image/png","image/jpeg","image/webp","application/octet-stream"],limit:"5mb"}),async(req,res)=>{try{const bytes=req.body;if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>5*1024*1024){res.status(400).json({error:"Image must be 16 bytes to 5 MB"});return;}const type=imageType(bytes);if(!type){res.status(415).json({error:"Only PNG, JPEG, or WebP files are supported"});return;}await mkdir(assetDir,{recursive:true});const name=`${randomUUID()}.${type.ext}`;await writeFile(path.join(assetDir,name),bytes,{flag:"wx"});res.status(201).json({url:`/api/billboard/assets/${name}`,bytes:bytes.length,mime:type.mime});}catch(e){res.status(500).json({error:String(e)});}});
 app.get("/api/billboard/assets/:name",async(req,res)=>{const name=String(req.params.name);if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)){res.status(404).end();return;}try{const bytes=await readFile(path.join(assetDir,name));res.setHeader("Content-Type",name.endsWith("png")?"image/png":name.endsWith("jpg")?"image/jpeg":"image/webp");res.setHeader("Cache-Control","private, max-age=3600");res.send(bytes);}catch{res.status(404).end();}});
 app.delete("/api/billboard/assets/:name",async(req,res)=>{const name=String(req.params.name);if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)){res.status(400).json({error:"Invalid asset name"});return;}try{const board=(await read()).board;if(board.slides.some(s=>s.imageUrl===`/api/billboard/assets/${name}`)){res.status(409).json({error:"Asset is used by a slide"});return;}await unlink(path.join(assetDir,name));res.json({deleted:true});}catch(e){res.status((e as NodeJS.ErrnoException).code==="ENOENT"?404:500).json({error:String(e)});}});

 app.get("/api/billboard",async(_req,res)=>{res.setHeader("Cache-Control","no-store");try{res.json(await read());}catch(e){res.status(500).json({error:String(e)});}});
 app.put("/api/billboard",async(req,res)=>{
  const task=async()=>{try{
   const current=await read();
   if(!Number.isInteger(req.body?.expectedRevision)||req.body.expectedRevision!==current.revision){res.status(409).json(current);return;}
   const board=normalize(req.body.board);
   const result={board,revision:current.revision+1};
   await mkdir(path.dirname(file),{recursive:true});
   const temp=`${file}.${process.pid}.tmp`;
   await writeFile(temp,JSON.stringify(result,null,2),"utf8");
   await rename(temp,file);
   res.setHeader("Cache-Control","no-store");res.json(result);
  }catch(e){res.status(400).json({error:String(e)});}};
  queue=queue.then(task,task);await queue;
 });
}
