import {CaptureLeaseGuard} from './client.mjs';
// An adapter for the existing YouTubeStreamManager. It does not modify FFmpeg or
// introduce a second stream manager. The caller must await start() and stop().
export class GuardedRelay{
 constructor({client,identity,startRelay,stopRelay,onLeaseLost=()=>{}}){this.guard=new CaptureLeaseGuard(client,identity,{onLeaseLost});this.startRelay=startRelay;this.stopRelay=stopRelay;this.active=false;}
 async start(){if(this.active)throw Error('RELAY_ALREADY_ACTIVE');await this.guard.acquire();try{await this.startRelay();this.active=true;this.guard.startHeartbeat();}catch(e){try{await this.guard.release();}catch(releaseError){throw new AggregateError([e,releaseError],'RELAY_START_FAILED_LEASE_UNCERTAIN');}throw e;}}
 async stop(){if(!this.active)return;await this.stopRelay();this.active=false;await this.guard.release();}
}
