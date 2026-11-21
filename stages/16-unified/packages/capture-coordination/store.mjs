import {mkdir,readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import path from 'node:path';
import {applyCommand} from './core.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class LeaseStore{
 constructor(dir,{lockTimeoutMs=5000,ttlMs=15000}={}){this.dir=path.resolve(dir);this.lockTimeoutMs=lockTimeoutMs;this.ttlMs=ttlMs;}
 async read(){try{const data=JSON.parse(await readFile(path.join(this.dir,'leases.json'),'utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_STORE');return data;}catch(e){if(e.code==='ENOENT')return {};throw e;}}
 async execute(command){await mkdir(this.dir,{recursive:true});const lock=path.join(this.dir,'leases.lock');let fd;const until=Date.now()+this.lockTimeoutMs;
  while(!fd){try{fd=await open(lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>until)throw Error('COORDINATOR_LOCK_BUSY');await sleep(25);}}
  try{const previous=await this.read();const {state,result}=applyCommand(previous,command,Date.now(),this.ttlMs);if(state!==previous){const tmp=path.join(this.dir,`leases.${process.pid}.${Date.now()}.tmp`);try{await writeFile(tmp,JSON.stringify(state,null,2),{flag:'wx',mode:0o600});await rename(tmp,path.join(this.dir,'leases.json'));}finally{await rm(tmp,{force:true});}}return result;}
  finally{await fd.close();await rm(lock,{force:true});}
 }
 async list(){return Object.values(await this.read());}
 async operatorClear(eventId,ringId,{confirmedStopped=false}={}){if(!confirmedStopped)throw Error('CAPTURE_STOP_CONFIRMATION_REQUIRED');await mkdir(this.dir,{recursive:true});const lock=path.join(this.dir,'leases.lock');let fd;try{fd=await open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('COORDINATOR_LOCK_BUSY');throw e;}
  try{const state=await this.read();const key=`${eventId}:${ringId}`;const removed=state[key]??null;delete state[key];const tmp=path.join(this.dir,`leases.${process.pid}.${Date.now()}.tmp`);try{await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,path.join(this.dir,'leases.json'));}finally{await rm(tmp,{force:true});}return removed;}finally{await fd.close();await rm(lock,{force:true});}
 }
}
