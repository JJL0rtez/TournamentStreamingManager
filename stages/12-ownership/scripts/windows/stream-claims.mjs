import { mkdir,open,readFile,rm,stat } from 'node:fs/promises';
import path from 'node:path';
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
export function validateClaim(claim){
 if(!claim||!valid(claim.eventId)||!valid(claim.ringId)||!valid(claim.nodeId)||!valid(claim.sessionId))throw new Error('Invalid claim fields');
 return {eventId:claim.eventId,ringId:claim.ringId,nodeId:claim.nodeId,sessionId:claim.sessionId};
}
export function claimConflict(existing,next){return existing.eventId===next.eventId&&existing.ringId===next.ringId&&existing.sessionId!==next.sessionId;}
export async function acquireLocalClaim(claim,dir=path.resolve('.tsm-runtime','stream-claims')){
 const data=validateClaim(claim);await mkdir(dir,{recursive:true});
 const file=path.join(dir,`${data.eventId}__${data.ringId}.json`);
 try{const fd=await open(file,'wx',0o600);try{await fd.writeFile(JSON.stringify({...data,createdAt:new Date().toISOString()}));}finally{await fd.close();}return {ok:true,file};}
 catch(e){if(e.code!=='EEXIST')throw e;const existing=JSON.parse(await readFile(file,'utf8'));return {ok:false,reason:'RING_ALREADY_CLAIMED',existing};}
}
export async function releaseLocalClaim(claim,dir=path.resolve('.tsm-runtime','stream-claims')){
 const data=validateClaim(claim);const file=path.join(dir,`${data.eventId}__${data.ringId}.json`);
 let existing;try{existing=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(existing.nodeId!==data.nodeId||existing.sessionId!==data.sessionId)throw new Error('Cannot release claim owned by another session');
 await rm(file);return true;
}
