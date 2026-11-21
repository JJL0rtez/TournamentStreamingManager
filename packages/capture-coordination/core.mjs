import {createHmac,timingSafeEqual,randomUUID,createHash} from 'node:crypto';
export const keyOf=(eventId,ringId)=>`${eventId}:${ringId}`;
export const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
// Member IDs never become a path or a coordinator wire identifier. Retain the full
// DirectShow alternative name so identical model names cannot collide.
export const validCameraId=x=>validId(x)||(typeof x==='string'&&x.length<=1024&&/^@device_(?:pnp|sw)_/.test(x)&&!/[\x00-\x1f\x7f]/.test(x));
export function ringIdForLabel(label){
 if(typeof label!=='string'||!label.trim()||label.length>120||/[\x00-\x1f\x7f/\\]/.test(label))throw Error('INVALID_RING_IDENTITY');
 // Existing valid IDs retain compatibility. Reserve the digest namespace for
 // names which cannot be sent as coordinator wire identifiers.
 if(validId(label)&&!label.startsWith('label-sha256-'))return label;
 return 'label-sha256-'+createHash('sha256').update(label,'utf8').digest('hex');
}
export function validateRequest(x){if(!x||!['acquire','renew','release','inspect'].includes(x.action)||![x.eventId,x.ringId,x.nodeId,x.sessionId].every(validId))throw new Error('INVALID_REQUEST');if(x.action!=='acquire'&&x.action!=='inspect'&&!validId(x.leaseId))throw new Error('INVALID_LEASE_ID');return x;}
export function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function sign(body,secret){return createHmac('sha256',secret).update(body).digest('hex');}
export function leaseExpired(lease,now){return lease.expiresAt<=now;}
export function applyCommand(state,command,now=Date.now(),ttlMs=15000){
 validateRequest(command);const key=keyOf(command.eventId,command.ringId);const current=state[key];const same=current&&current.nodeId===command.nodeId&&current.sessionId===command.sessionId;
 const next={...state};
 if(command.action==='inspect')return {state,result:{ok:true,lease:current??null}};
 if(command.action==='acquire'){
  // Expired leases are NOT reassigned automatically. A live FFmpeg may survive a disconnected owner.
  if(current)return {state,result:{ok:false,code:leaseExpired(current,now)?'STALE_LEASE_REQUIRES_OPERATOR':'RING_OWNED',lease:current}};
  const lease={eventId:command.eventId,ringId:command.ringId,nodeId:command.nodeId,sessionId:command.sessionId,leaseId:randomUUID(),issuedAt:now,expiresAt:now+ttlMs,revision:1};next[key]=lease;return {state:next,result:{ok:true,lease}};
 }
 if(!current)return {state,result:{ok:false,code:'LEASE_NOT_FOUND'}};
 if(!same||!safeEqual(current.leaseId,command.leaseId))return {state,result:{ok:false,code:'LEASE_OWNER_MISMATCH'}};
 if(command.action==='renew'){const lease={...current,expiresAt:now+ttlMs,revision:current.revision+1};next[key]=lease;return {state:next,result:{ok:true,lease}};}
 if(command.action==='release'){delete next[key];return {state:next,result:{ok:true,released:true}};}
 throw new Error('INVALID_ACTION');
}
