import express, {type Express} from "express";
import {randomUUID} from "node:crypto";
import {readFile,writeFile,mkdir,rename,readdir,unlink,stat} from "node:fs/promises";
import path from "node:path";
type Slide={id:string;title:string;body:string;duration:number;kind:"announcement"|"sponsor"|"schedule";imageUrl?:string;theme?:"default"|"blue"|"gold"|"dark"};
type Board={slides:Slide[];updatedAt:number};
const file=path.resolve(process.cwd(),"data","billboard.json");
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
export function installBillboardRoutes(app:Express){
 app.get("/api/billboard/assets",async(_req,res)=>{try{const files=await readdir(assetDir).catch((e:NodeJS.ErrnoException)=>{if(e.code==="ENOENT")return [];throw e;});const result=await Promise.all(files.filter(x=>/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(x)).map(async name=>({name,displayName:await readFile(path.join(assetDir,`${name}.name`),"utf8").catch(()=>name),url:`/api/billboard/assets/${name}`,bytes:(await stat(path.join(assetDir,name))).size})));res.setHeader("Cache-Control","no-store");res.json({assets:result});}catch(e){res.status(500).json({error:String(e)});}});
 app.post("/api/billboard/assets",express.raw({type:["image/png","image/jpeg","image/webp","application/octet-stream"],limit:"5mb"}),async(req,res)=>{try{const bytes=req.body;if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>5*1024*1024){res.status(400).json({error:"Image must be 16 bytes to 5 MB"});return;}const type=imageType(bytes);if(!type){res.status(415).json({error:"Only PNG, JPEG, or WebP files are supported"});return;}await mkdir(assetDir,{recursive:true});const name=`${randomUUID()}.${type.ext}`;await writeFile(path.join(assetDir,name),bytes,{flag:"wx"});
 const rawName=String(req.headers["x-original-filename"]||"");let displayName="";try{displayName=decodeURIComponent(rawName);}catch{}
 displayName=displayName.replace(/[\\/\x00-\x1f\x7f]/g,"_").slice(0,180).trim();
 if(displayName)await writeFile(path.join(assetDir,`${name}.name`),displayName,"utf8");
 res.status(201).json({url:`/api/billboard/assets/${name}`,bytes:bytes.length,mime:type.mime});}catch(e){res.status(500).json({error:String(e)});}});
 app.get("/api/billboard/assets/:name",async(req,res)=>{const name=String(req.params.name);if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)){res.status(404).end();return;}try{const bytes=await readFile(path.join(assetDir,name));res.setHeader("Content-Type",name.endsWith("png")?"image/png":name.endsWith("jpg")?"image/jpeg":"image/webp");res.setHeader("Cache-Control","private, max-age=3600");res.send(bytes);}catch{res.status(404).end();}});
 app.delete("/api/billboard/assets/:name",async(req,res)=>{const name=String(req.params.name);if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)){res.status(400).json({error:"Invalid asset name"});return;}try{const board=(await read()).board;if(board.slides.some(s=>s.imageUrl===`/api/billboard/assets/${name}`)){res.status(409).json({error:"Asset is used by a slide"});return;}await unlink(path.join(assetDir,name));await unlink(path.join(assetDir,`${name}.name`)).catch(()=>{});res.json({deleted:true});}catch(e){res.status((e as NodeJS.ErrnoException).code==="ENOENT"?404:500).json({error:String(e)});}});

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
