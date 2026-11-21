import { randomUUID } from 'node:crypto';
import { LeaseClient, CaptureLeaseGuard } from './client.mjs';
import { validId, validCameraId, ringIdForLabel } from './core.mjs';

/** One ring lease shared by capture, legacy recording and YouTube on the same node.
 * Failed stop/release intentionally leaves the ring reserved for manual recovery. */
export class UnifiedRingLifecycle {
  constructor({client, identityFor, onIncident = () => {}}) {
    this.client = client; this.identityFor = identityFor; this.onIncident = onIncident;
    this.rings = new Map(); this.cameraRings = new Map(); this.pending = new Set(); this.pendingRingAcquires = new Set(); this.pendingRingStops = new Set();
  }
  async start(kind, cameraId, startFn) {
    if (!['capture','recording','youtube'].includes(kind) || !validCameraId(cameraId)) throw Error('INVALID_PIPELINE');
    const token = `${kind}:${cameraId}`;
    if (this.pending.has(token)) throw Error('PIPELINE_OPERATION_IN_PROGRESS');
    this.pending.add(token);
    let entry;
    try {
      const identity = this.identityFor(cameraId);
      if (![identity.eventId,identity.ringId,identity.nodeId].every(validId)) throw Error('INVALID_RING_IDENTITY');
      const ringKey = `${identity.eventId}:${identity.ringId}`;
      if (this.cameraRings.has(cameraId) && this.cameraRings.get(cameraId) !== ringKey) throw Error('CAMERA_RING_CHANGED_WHILE_ACTIVE');
      if (this.pendingRingStops.has(ringKey)) throw Error('RING_STOP_IN_PROGRESS');
      entry = this.rings.get(ringKey);
      if (entry && !entry.guard.isUsable()) { entry.state = 'uncertain'; throw Error('RING_OWNERSHIP_UNCERTAIN'); }
      if (entry && entry.state !== 'active') throw Error('RING_OWNERSHIP_UNCERTAIN');
      if (entry && entry.identity.nodeId !== identity.nodeId) throw Error('RING_NODE_MISMATCH');
      if (entry?.members.has(token)) throw Error('PIPELINE_ALREADY_OWNED');
      if (!entry) {
        const guard = new CaptureLeaseGuard(this.client, {...identity,sessionId:randomUUID()}, {onLeaseLost: error => {
          const current = this.rings.get(ringKey);
          if (current) { current.state = 'uncertain'; this.onIncident({type:'coordinator-lost',ringKey,error:String(error)}); }
        }});
        // Serialize the first lease acquisition for a ring. Different cameras may
        // be assigned to the same ring, so per-camera pending flags are insufficient.
        if (this.pendingRingAcquires.has(ringKey)) throw Error('RING_ACQUIRE_IN_PROGRESS');
        this.pendingRingAcquires.add(ringKey);
        try {
          await guard.acquire();
          entry = {identity, guard, state:'active', members:new Set(), pendingStarts:0};
          this.rings.set(ringKey,entry);
          guard.startHeartbeat();
        } finally {
          this.pendingRingAcquires.delete(ringKey);
        }
      }
      entry.pendingStarts++;
      try {
        const result = await startFn();
        // The coordinator may have become unreachable while FFmpeg was starting.
        // Preserve the process and lease for manual reconciliation, but never
        // report the ring as safely owned after that transition.
        entry.members.add(token);
        this.cameraRings.set(cameraId,ringKey);
        if (!entry.guard.isUsable() || entry.state !== 'active') {
          entry.state = 'uncertain';
          this.onIncident({type:'start-after-lease-loss',ringKey,token});
          throw Object.assign(Error('RING_OWNERSHIP_UNCERTAIN'), {pipelineStarted:true});
        }
        return result;
      }
      catch (error) {
        // A rejected start can still have spawned FFmpeg. Never release automatically.
        entry.state = 'uncertain';
        if (!error?.pipelineStarted) this.onIncident({type:'start-uncertain',ringKey,token,error:String(error)});
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
      // Serialize all stops for one ring, including lease release. Otherwise two
      // last-member stops can both release or delete ownership concurrently.
      if (this.pendingRingStops.has(ringKey)) throw Error('RING_STOP_IN_PROGRESS');
      // A second camera can be starting on this ring even if this camera is
      // already running. Never stop/release while any start is in flight.
      if (entry.pendingStarts > 0 || this.pendingRingAcquires.has(ringKey)) throw Error('RING_START_IN_PROGRESS');
      this.pendingRingStops.add(ringKey);
      try {
      try {await stopFn();} catch(error) {entry.state='uncertain';this.onIncident({type:'stop-uncertain',ringKey,token,error:String(error)});throw error;}
      entry.members.delete(token);
      if (!entry.members.size && entry.pendingStarts === 0) {
        try {await entry.guard.release();this.rings.delete(ringKey);}
        catch(error) {entry.state='uncertain';this.onIncident({type:'release-uncertain',ringKey,error:String(error)});throw error;}
      }
      if (![...this.rings.values()].some(e=>e.members.has(`capture:${cameraId}`)||e.members.has(`recording:${cameraId}`)||e.members.has(`youtube:${cameraId}`))) this.cameraRings.delete(cameraId);
      } finally { this.pendingRingStops.delete(ringKey); }
    } finally {this.pending.delete(token);}
  }
  /** Restart an already tracked pipeline without dropping ring ownership.
   * Stop and replacement start are serialized against all operations on the ring.
   * Any failure leaves the ring uncertain and reserved for manual reconciliation.
   */
  async restart(kind, cameraId, restartFn) {
    return this.runOwnedOperation(kind,cameraId,restartFn,'restart');
  }
  /** Serialize an in-place output change under the existing capture lease.
   * No new lease is acquired and no other pipeline is stopped or released. */
  async changeOutput(cameraId, changeFn) {
    return this.runOwnedOperation('capture',cameraId,changeFn,'output-change');
  }
  async runOwnedOperation(kind, cameraId, restartFn, action) {
    if (!['capture','recording','youtube'].includes(kind) || !validCameraId(cameraId) || typeof restartFn !== 'function') throw Error('INVALID_PIPELINE');
    const token = `${kind}:${cameraId}`;
    const ringKey = this.cameraRings.get(cameraId);
    const entry = ringKey && this.rings.get(ringKey);
    if (!entry?.members.has(token)) throw Error('UNTRACKED_PIPELINE_REQUIRES_MANUAL_RECOVERY');
    if (this.pending.has(token) || this.pendingRingStops.has(ringKey) || this.pendingRingAcquires.has(ringKey) || entry.pendingStarts > 0) throw Error('RING_OPERATION_IN_PROGRESS');
    if (entry.state !== 'active' || !entry.guard.isUsable()) {entry.state='uncertain';throw Error('RING_OWNERSHIP_UNCERTAIN');}
    this.pending.add(token);
    this.pendingRingStops.add(ringKey);
    try {
      // Recheck ownership after entering the operation lock.
      if (entry.state !== 'active' || !entry.guard.isUsable()) {entry.state='uncertain';throw Error('RING_OWNERSHIP_UNCERTAIN');}
      const result = await restartFn();
      if (entry.state !== 'active' || !entry.guard.isUsable()) {entry.state='uncertain';this.onIncident({type:`${action}-after-lease-loss`,ringKey,token});throw Error('RING_OWNERSHIP_UNCERTAIN');}
      return result;
    } catch(error) {
      // Do not remove membership or release a lease after an ambiguous FFmpeg restart.
      entry.state='uncertain';
      this.onIncident({type:`${action}-uncertain`,ringKey,token,error:String(error)});
      throw error;
    } finally {this.pendingRingStops.delete(ringKey);this.pending.delete(token);}
  }
  /** Retry release only after the operator has independently verified that no
   * FFmpeg pipeline for this ring remains active. Never force-release a live ring.
   * A failed coordinator response retains the entry and can be retried later. */
  async reconcileEmptyRing(ringKey, {confirmedStopped = false} = {}) {
    if (!confirmedStopped) throw Error('OPERATOR_CONFIRMATION_REQUIRED');
    const entry = this.rings.get(ringKey);
    if (!entry) throw Error('RING_NOT_TRACKED');
    if (entry.members.size || entry.pendingStarts || this.pendingRingAcquires.has(ringKey)) throw Error('RING_PIPELINES_STILL_TRACKED');
    if (this.pendingRingStops.has(ringKey)) throw Error('RING_STOP_IN_PROGRESS');
    this.pendingRingStops.add(ringKey);
    try {
      await entry.guard.release();
      this.rings.delete(ringKey);
      for (const [cameraId, key] of this.cameraRings) if (key === ringKey) this.cameraRings.delete(cameraId);
      this.onIncident({type:'empty-ring-released',ringKey});
      return {released:true,ringKey};
    } catch (error) {
      entry.state = 'uncertain';
      this.onIncident({type:'manual-release-failed',ringKey,error:String(error)});
      throw error;
    } finally { this.pendingRingStops.delete(ringKey); }
  }
  hasMember(kind, cameraId) {const key=this.cameraRings.get(cameraId);return Boolean(key && this.rings.get(key)?.members.has(`${kind}:${cameraId}`));}
  status() {return [...this.rings.entries()].map(([ringKey,e])=>({ringKey,state:e.state,members:[...e.members],leaseLost:!e.guard.isUsable(),pendingStarts:e.pendingStarts,stopInProgress:this.pendingRingStops.has(ringKey),requiresReconciliation:e.state==='uncertain',empty:e.members.size===0}));}
}
export function createUnifiedLifecycle({getSession,nodeId=process.env.TSM_NODE_ID,url=process.env.TSM_COORDINATOR_URL,secret=process.env.TSM_COORDINATOR_SECRET,onIncident,client}={}) {
  const leaseClient = client ?? (url && secret?.length >= 32 ? new LeaseClient({url,secret}) : null);
  if (!leaseClient || !validId(nodeId)) throw Error('COORDINATOR_CONFIGURATION_REQUIRED');
  return new UnifiedRingLifecycle({client:leaseClient,onIncident,identityFor:cameraId=>{
    const session=getSession();
    if (!session) throw Error('TOURNAMENT_SESSION_REQUIRED');
    const assignments=session.assignments.filter(a=>a.cameraId===cameraId);
    if(assignments.length!==1) throw Error('CAMERA_RING_ASSIGNMENT_REQUIRED');
    return {eventId:session.eventId,ringId:ringIdForLabel(assignments[0].ring),nodeId};
  }});
}
