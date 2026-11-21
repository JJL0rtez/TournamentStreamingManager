import {sign} from './core.mjs';
export class LeaseClient{
 constructor({url,secret,timeoutMs=3000,fetchImpl=fetch}){if(!url||!secret)throw Error('COORDINATOR_CONFIG_REQUIRED');this.url=url.replace(/\/$/,'');this.secret=secret;this.timeoutMs=timeoutMs;this.fetchImpl=fetchImpl;}
 async command(command){const body=JSON.stringify(command);const timestamp=Date.now();const response=await this.fetchImpl(`${this.url}/v1/lease`,{method:'POST',headers:{'content-type':'application/json','x-tsm-timestamp':String(timestamp),'x-tsm-signature':sign(`${timestamp}.${body}`,this.secret)},body,signal:AbortSignal.timeout(this.timeoutMs)});const result=await response.json();if(!response.ok&&response.status!==409)throw Error(result.error||'COORDINATOR_REQUEST_FAILED');return result;}
 acquire(data){return this.command({...data,action:'acquire'});}renew(data){return this.command({...data,action:'renew'});}release(data){return this.command({...data,action:'release'});}inspect(data){return this.command({...data,action:'inspect'});}
}
export class CaptureLeaseGuard{
 constructor(client,identity,{renewEveryMs=5000,onLeaseLost=()=>{}}={}){this.client=client;this.identity=identity;this.renewEveryMs=renewEveryMs;this.onLeaseLost=onLeaseLost;this.lease=null;this.timer=null;this.lost=false;}
 async acquire(){if(this.lease)throw Error('LEASE_ALREADY_HELD');const result=await this.client.acquire(this.identity);if(!result.ok)throw Error(result.code);this.lease=result.lease;return this.lease;}
 startHeartbeat(){if(!this.lease)throw Error('LEASE_REQUIRED');if(this.timer)return;this.timer=setInterval(async()=>{try{const result=await this.client.renew({...this.identity,leaseId:this.lease.leaseId});if(!result.ok)throw Error(result.code);this.lease=result.lease;}catch(e){if(!this.lost){this.lost=true;this.onLeaseLost(e);}}},this.renewEveryMs);this.timer.unref?.();}
 async release(){if(this.timer)clearInterval(this.timer);this.timer=null;if(!this.lease)return;const lease=this.lease;const result=await this.client.release({...this.identity,leaseId:lease.leaseId});if(!result.ok)throw Error(result.code);this.lease=null;}
}
