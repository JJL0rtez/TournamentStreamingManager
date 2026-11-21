import { randomUUID } from 'node:crypto';
import { LeaseClient, CaptureLeaseGuard } from './client.mjs';
import { validId } from './core.mjs';

/** One ring lease shared by capture, legacy recording and YouTube on the same node.
 * Failed stop/release intentionally leaves the ring reserved for manual recovery. */
export class UnifiedRingLifecycle {
  constructor({client, identityFor, onIncident = () => {}}) {
    this.client = client; this.identityFor = identityFor; this.onIncident = onIncident;
    this.rings = new Map(); this.cameraRings = new Map(); this.pending = new Set();
  }
  async start(kind, cameraId, startFn) {
    if (!['capture','recording','youtube'].includes(kind) || !validId(cameraId)) throw Error('INVALID_PIPELINE');
    const token = `${kind}:${cameraId}`;
    if (this.pending.has(token)) throw Error('PIPELINE_OPERATION_IN_PROGRESS');
    this.pending.add(token);
    let entry, created = false, started = false;
    try {
      const identity = this.identityFor(cameraId);
      if (![identity.eventId,identity.ringId,identity.nodeId].every(validId)) throw Error('INVALID_RING_IDENTITY');
      const ringKey = `${identity.eventId}:${identity.ringId}`;
      if (this.cameraRings.has(cameraId) && this.cameraRings.get(cameraId) !== ringKey) throw Error('CAMERA_RING_CHANGED_WHILE_ACTIVE');
      entry = this.rings.get(ringKey);
      if (entry && entry.state !== 'active') throw Error('RING_OWNERSHIP_UNCERTAIN');
      if (entry && entry.identity.nodeId !== identity.nodeId) throw Error('RING_NODE_MISMATCH');
      if (entry?.members.has(token)) throw Error('PIPELINE_ALREADY_OWNED');
      if (!entry) {
        const guard = new CaptureLeaseGuard(this.client, {...identity,sessionId:randomUUID()}, {onLeaseLost: error => {
          const current = this.rings.get(ringKey);
          if (current) { current.state = 'uncertain'; this.onIncident({type:'coordinator-lost',ringKey,error:String(error)}); }
        }});
        await guard.acquire();
        entry = {identity, guard, state:'active', members:new Set(), pendingStarts:0};
        this.rings.set(ringKey,entry); created = true;
        guard.startHeartbeat();
      }
      entry.pendingStarts++;
      try {const result = await startFn(); started = true; entry.members.add(token); this.cameraRings.set(cameraId,ringKey); return result;}
      catch (error) {
        // A rejected start can still have spawned FFmpeg. Never release automatically.
        entry.state = 'uncertain'; this.onIncident({type:'start-uncertain',ringKey,token,error:String(error)});
        throw error;
      } finally {entry.pendingStarts--;}
    } finally {this.pending.delete(token);}
  }
  async stop(kind,cameraId,stopFn) {
    const token = `${kind}:${cameraId}`;
    if (this.pending.has(token)) throw Error('PIPELINE_OPERATION_IN_PROGRESS');
    this.pending.add(token);
    try {
      const ringKey = this.cameraRings.get(cameraId);
      const entry = ringKey && this.rings.get(ringKey);
      if (!entry?.members.has(token)) throw Error('UNTRACKED_PIPELINE_REQUIRES_MANUAL_RECOVERY');
      try {await stopFn();} catch(error) {entry.state='uncertain';this.onIncident({type:'stop-uncertain',ringKey,token,error:String(error)});throw error;}
      entry.members.delete(token);
      if (!entry.members.size && entry.pendingStarts === 0) {
        try {await entry.guard.release();this.rings.delete(ringKey);}
        catch(error) {entry.state='uncertain';this.onIncident({type:'release-uncertain',ringKey,error:String(error)});throw error;}
      }
      if (![...this.rings.values()].some(e=>e.members.has(`capture:${cameraId}`)||e.members.has(`recording:${cameraId}`)||e.members.has(`youtube:${cameraId}`))) this.cameraRings.delete(cameraId);
    } finally {this.pending.delete(token);}
  }
  status() {return [...this.rings.entries()].map(([ringKey,e])=>({ringKey,state:e.state,members:[...e.members],leaseLost:e.guard.lost}));}
}
export function createUnifiedLifecycle({getSession,nodeId=process.env.TSM_NODE_ID,url=process.env.TSM_COORDINATOR_URL,secret=process.env.TSM_COORDINATOR_SECRET,onIncident,client}={}) {
  const leaseClient = client ?? (url && secret?.length >= 32 ? new LeaseClient({url,secret}) : null);
  if (!leaseClient || !validId(nodeId)) throw Error('COORDINATOR_CONFIGURATION_REQUIRED');
  return new UnifiedRingLifecycle({client:leaseClient,onIncident,identityFor:cameraId=>{
    const session=getSession();
    if (!session) throw Error('TOURNAMENT_SESSION_REQUIRED');
    const assignments=session.assignments.filter(a=>a.cameraId===cameraId);
    if(assignments.length!==1) throw Error('CAMERA_RING_ASSIGNMENT_REQUIRED');
    return {eventId:session.eventId,ringId:assignments[0].ring,nodeId};
  }});
}
