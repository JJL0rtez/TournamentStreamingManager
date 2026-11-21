import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const execFileAsync=promisify(execFile);
export const runtimeDir=path.resolve('.tsm-runtime');
const validId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function parseWindowsProcessList(raw){
 const rows=Array.isArray(raw)?raw:raw?[raw]:[];
 return rows.filter(x=>Number.isInteger(Number(x.ProcessId)) && Number(x.ProcessId)>0).map(x=>({pid:Number(x.ProcessId),parentPid:Number(x.ParentProcessId)||null,name:String(x.Name??''),commandLine:String(x.CommandLine??''),creationDate:String(x.CreationDate??'')}));
}
export function classifyOwnedProcess({record,processes,now=Date.now()}){
 if(!record || !validId(record.id) || !Number.isInteger(record.pid) || record.pid<1)return {state:'invalid',reason:'INVALID_OWNERSHIP_RECORD'};
 const p=processes.find(x=>x.pid===record.pid);
 if(!p)return {state:'stopped',reason:'PID_NOT_RUNNING'};
 if(!/^ffmpeg(?:\.exe)?$/i.test(p.name))return {state:'ambiguous',reason:'PID_REUSED_BY_OTHER_PROGRAM'};
 if(record.creationDate && p.creationDate && record.creationDate!==p.creationDate)return {state:'ambiguous',reason:'PID_REUSED_NEW_START_TIME'};
 if(record.commandFingerprint && !p.commandLine.includes(record.commandFingerprint))return {state:'ambiguous',reason:'COMMAND_FINGERPRINT_MISMATCH'};
 if(record.lastHeartbeatAt && now-Date.parse(record.lastHeartbeatAt)>60000)return {state:'ambiguous',reason:'STALE_HEARTBEAT'};
 return {state:'running',reason:'OWNED_FFMPEG_STILL_RUNNING',pid:p.pid};
}
export async function windowsProcesses(runner=execFileAsync){
 if(process.platform!=='win32')throw new Error('Windows process ownership is Windows-only');
 const command=`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Select-Object Name,ProcessId,ParentProcessId,CommandLine,CreationDate) | ConvertTo-Json -Compress -Depth 4`;
 const {stdout}=await runner('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{timeout:12000,maxBuffer:1024*1024,windowsHide:true});
 return parseWindowsProcessList(JSON.parse(stdout.trim()||'[]'));
}
export async function readOwnershipRecords(directory=runtimeDir){
 const file=path.join(directory,'capture-ownership.json');
 try{const value=JSON.parse(await readFile(file,'utf8'));return Array.isArray(value)?value:[];}catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export function ownershipReport(records,processes){
 const results=records.map(record=>({id:record.id,...classifyOwnedProcess({record,processes})}));
 const ownedPids=new Set(records.map(x=>x.pid));
 const unknown=processes.filter(p=>/^ffmpeg(?:\.exe)?$/i.test(p.name)&&!ownedPids.has(p.pid));
 return {results,unknown,canRestart:results.every(x=>x.state==='stopped')&&unknown.length===0,reason:unknown.length?'UNOWNED_FFMPEG_PRESENT':results.some(x=>x.state!=='stopped')?'CAPTURE_STILL_RUNNING_OR_AMBIGUOUS':'NO_ACTIVE_CAPTURE'};
}
export async function captureOwnershipReport({directory=runtimeDir,processReader=windowsProcesses}={}){
 try{return ownershipReport(await readOwnershipRecords(directory),await processReader());}
 catch(error){return {results:[],unknown:[],canRestart:false,reason:'OWNERSHIP_INSPECTION_FAILED',error:String(error)};}
}
// Registry writer for integration with capture start/stop. A process is only
// considered owned after the capture manager supplies a PID and start identity.
export async function writeOwnershipRecords(records,directory=runtimeDir){
 if(!Array.isArray(records)||records.some(x=>!validId(x.id)||!Number.isInteger(x.pid)||x.pid<1))throw new Error('Invalid capture ownership records');
 await mkdir(directory,{recursive:true});const file=path.join(directory,'capture-ownership.json');const temp=file+'.tmp';
 await writeFile(temp,JSON.stringify(records,null,2),{flag:'w',mode:0o600});await rename(temp,file);
}
