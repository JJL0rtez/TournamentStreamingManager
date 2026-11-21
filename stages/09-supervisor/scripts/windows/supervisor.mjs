#!/usr/bin/env node
// Resilient Windows launcher. Supervises npm launcher, not FFmpeg capture children.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = path.join(project,'.tsm-runtime');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
export function restartDelay(crashes,base=2000,max=120000){return Math.min(max,base*2**Math.min(10,Math.max(0,crashes-1)));}
export function restartDecision({role,uptimeMs,exitCode,stopping,crashes}){
 if(stopping)return {restart:false,reason:'SHUTDOWN'};
 // A Node launcher exiting cleanly is still unexpected in a persistent role.
 return {restart:true,reason:exitCode===0?'UNEXPECTED_EXIT':'PROCESS_EXIT',delayMs:restartDelay(uptimeMs>60000?1:crashes)};
}
export function validateConfig(value){
 if(!value||typeof value!=='object')throw new Error('Invalid config');
 if(!['node','dashboard'].includes(value.role))throw new Error('Invalid role');
 if(value.maxRestarts!==undefined&&(!Number.isInteger(value.maxRestarts)||value.maxRestarts<0||value.maxRestarts>1000))throw new Error('Invalid maxRestarts');
 if(value.healthUrl!==undefined){const url=new URL(value.healthUrl);if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','::1'].includes(url.hostname))throw new Error('Health URL must be local');}
 return {role:value.role,maxRestarts:value.maxRestarts??0,healthUrl:value.healthUrl??null};
}
async function atomicJson(file,value){const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,file);}
async function appendLog(file,message){
 try{if((await stat(file)).size>5*1024*1024)await rename(file,file+'.previous');}catch{}
 const h=await open(file,'a');try{await h.writeFile(`[${new Date().toISOString()}] ${message}\n`);}finally{await h.close();}
}
export async function runSupervisor(config,opts={}){
 const {role,maxRestarts,healthUrl}=validateConfig(config);
 await mkdir(runtime,{recursive:true});
 const statusFile=path.join(runtime,`${role}.supervisor.json`);
 const logFile=path.join(runtime,`${role}.supervisor.log`);
 const npm=process.platform==='win32'?'npm.cmd':'npm';
 const script=role==='node'?'dev:node':'dev';
 let stopping=false,child=null,crashes=0,startedAt=Date.now(),lastHealth=null;
 const publish=async(status,detail={})=>atomicJson(statusFile,{role,status,supervisorPid:process.pid,supervisorStartedAt:new Date(startedAt).toISOString(),childPid:child?.pid??null,crashes,lastHealth,updatedAt:new Date().toISOString(),...detail});
 const terminate=()=>{stopping=true;};
 process.on('SIGINT',terminate);process.on('SIGTERM',terminate);
 const healthTimer=healthUrl?setInterval(async()=>{
  try{const response=await fetch(healthUrl,{signal:AbortSignal.timeout(3000)});lastHealth={ok:response.ok,status:response.status,at:new Date().toISOString()};}
  catch(error){lastHealth={ok:false,error:String(error),at:new Date().toISOString()};}
  // Health failures are diagnostic ONLY: never restart a live capture process.
  await publish(child?'running':'waiting').catch(()=>{});
 },15000):null;
 try{
  while(!stopping){
   const runStart=Date.now();
   const stdout=await open(path.join(runtime,`${role}.stdout.log`),'a');
   const stderr=await open(path.join(runtime,`${role}.stderr.log`),'a');
   let exitCode=null;
   try{
    child=spawn(npm,['run',script],{cwd:project,windowsHide:true,stdio:['ignore',stdout.fd,stderr.fd],shell:process.platform==='win32'});
    await publish('running');
    exitCode=await new Promise(resolve=>{child.once('error',e=>{void appendLog(logFile,`spawn error: ${e}`);resolve(-1);});child.once('exit',(code,signal)=>resolve(code??-1));});
   }finally{child=null;await stdout.close();await stderr.close();}
   crashes=Date.now()-runStart>60000?1:crashes+1;
   const decision=restartDecision({role,uptimeMs:Date.now()-runStart,exitCode,stopping,crashes});
   await appendLog(logFile,`${role} exited (${exitCode}), ${decision.reason}, crashes=${crashes}`);
   if(!decision.restart || (maxRestarts>0&&crashes>maxRestarts))break;
   await publish('backoff',{nextRestartAt:new Date(Date.now()+decision.delayMs).toISOString()});
   // Interruptible backoff; shutdown never intentionally terminates FFmpeg.
   for(let waited=0;waited<decision.delayMs&&!stopping;waited+=250)await sleep(Math.min(250,decision.delayMs-waited));
  }
 }finally{
  if(healthTimer)clearInterval(healthTimer);
  await publish(stopping?'shutdown-requested':'stopped');
  process.off('SIGINT',terminate);process.off('SIGTERM',terminate);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const role=process.argv[2];const healthUrl=process.env.TSM_SUPERVISOR_HEALTH_URL;
 runSupervisor({role,healthUrl}).catch(error=>{console.error(error);process.exitCode=1;});
}
