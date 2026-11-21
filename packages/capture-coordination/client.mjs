import {sign} from './core.mjs';
export class LeaseClient{
 constructor({url,secret,timeoutMs=3000,fetchImpl=fetch}){if(!url||!secret)throw Error('COORDINATOR_CONFIG_REQUIRED');this.url=url.replace(/\/$/,'');this.secret=secret;this.timeoutMs=timeoutMs;this.fetchImpl=fetchImpl;}
 async command(command){const body=JSON.stringify(command);const timestamp=Date.now();const response=await this.fetchImpl(`${this.url}/v1/lease`,{method:'POST',headers:{'content-type':'application/json','x-tsm-timestamp':String(timestamp),'x-tsm-signature':sign(`${timestamp}.${body}`,this.secret)},body,signal:AbortSignal.timeout(this.timeoutMs)});const result=await response.json();if(!response.ok&&response.status!==409)throw Error(result.error||'COORDINATOR_REQUEST_FAILED');return result;}
 acquire(data){return this.command({...data,action:'acquire'});}renew(data){return this.command({...data,action:'renew'});}release(data){return this.command({...data,action:'release'});}inspect(data){return this.command({...data,action:'inspect'});}
}
/** A failed or ambiguous renewal is fail-closed: never silently regain ownership.
 * An in-flight heartbeat must finish before a release request is issued. */
export class CaptureLeaseGuard {
 constructor(client,identity,{renewEveryMs=5000,onLeaseLost=()=>{}}={}) {
  this.client=client;this.identity=identity;this.renewEveryMs=renewEveryMs;
  this.onLeaseLost=onLeaseLost;this.lease=null;this.timer=null;this.lost=false;
  this.renewInFlight=null;this.releasing=false;this.expiryTimer=null;
 }
 async acquire() {
  if(this.lease||this.releasing)throw Error('LEASE_ALREADY_HELD');
  const result=await this.client.acquire(this.identity);
  if(!result.ok)throw Error(result.code||'LEASE_ACQUIRE_FAILED');
  if(!result.lease || (result.lease.expiresAt != null && (!Number.isFinite(Number(result.lease.expiresAt))||Number(result.lease.expiresAt)<=Date.now())))throw Error('LEASE_ACQUIRE_INVALID_EXPIRY');
  this.lease=result.lease;this.lost=false;this.scheduleExpiry();return this.lease;
 }
 async renewOnce() {
  if(!this.isUsable())return;
  if(this.renewInFlight)return this.renewInFlight;
  const current=this.lease;
  const operation=(async()=>{
   try {
    const result=await this.client.renew({...this.identity,leaseId:current.leaseId});
    if(!result.ok)throw Error(result.code||'LEASE_RENEW_FAILED');
    if(!result.lease || result.lease.leaseId !== current.leaseId)throw Error('LEASE_RENEW_IDENTITY_MISMATCH');
    if(result.lease.expiresAt != null && (!Number.isFinite(Number(result.lease.expiresAt))||Number(result.lease.expiresAt)<=Date.now()))throw Error('LEASE_RENEW_INVALID_EXPIRY');
    if(!this.releasing&&!this.lost&&this.lease===current){this.lease=result.lease;this.scheduleExpiry();}
   } catch(error) {
    this.markLost(error);
   }
  })();
  this.renewInFlight=operation;
  try {await operation;} finally {if(this.renewInFlight===operation)this.renewInFlight=null;}
 }
 markLost(error) {
  if(this.lost)return;
  this.lost=true;this.stopHeartbeat();this.onLeaseLost(error);
 }
 /** Coordinator expiry is a hard deadline, even when a timer is delayed or
  * the network has not yet returned an error. Never infer ownership after it. */
 isUsable() {
  if(!this.lease||this.lost||this.releasing)return false;
  if(this.lease.expiresAt == null)return true;
  const expiresAt=Number(this.lease.expiresAt);
  if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){
   this.markLost(Error('LEASE_EXPIRED_OR_INVALID'));
   return false;
  }
  return true;
 }
 scheduleExpiry() {
  if(this.expiryTimer)clearTimeout(this.expiryTimer);
  this.expiryTimer=null;
  if(this.lease?.expiresAt == null)return;
  const expiresAt=Number(this.lease.expiresAt);
  if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){
   this.markLost(Error('LEASE_EXPIRED_OR_INVALID'));return;
  }
  this.expiryTimer=setTimeout(()=>{this.expiryTimer=null;this.isUsable();},Math.min(expiresAt-Date.now()+1,2147483647));
  this.expiryTimer.unref?.();
 }
 startHeartbeat() {
  if(!this.lease)throw Error('LEASE_REQUIRED');
  if(!this.isUsable())throw Error('LEASE_OWNERSHIP_UNCERTAIN');
  if(this.timer)return;
  this.timer=setInterval(()=>{void this.renewOnce();},this.renewEveryMs);
  this.timer.unref?.();
 }
 stopHeartbeat(){if(this.timer)clearInterval(this.timer);this.timer=null;if(this.expiryTimer)clearTimeout(this.expiryTimer);this.expiryTimer=null;}
 async release() {
  if(this.releasing)throw Error('LEASE_RELEASE_IN_PROGRESS');
  this.releasing=true;this.stopHeartbeat();
  try {
   if(this.renewInFlight)await this.renewInFlight;
   if(!this.lease)return;
   const lease=this.lease;
   const result=await this.client.release({...this.identity,leaseId:lease.leaseId});
   if(!result.ok)throw Error(result.code||'LEASE_RELEASE_FAILED');
   this.lease=null;
  } finally {this.releasing=false;}
 }
}
