import {validId,validCameraId,ringIdForLabel} from './core.mjs';

/** Read-only, deterministic preflight. Never acquires, renews or releases a lease. */
export function evaluateOwnershipReadiness({session=null, nodeId='', coordinatorConfigured=false, active={}, claims=[]}={}) {
  const captures = [...new Set(active.captures ?? [])];
  const recordings = [...new Set(active.recordings ?? [])];
  const youtube = [...new Set(active.youtube ?? [])];
  const activeIds = [...new Set([...captures,...recordings,...youtube])];
  const assignments = Array.isArray(session?.assignments) ? session.assignments : [];
  const counts = new Map();
  const ringCameras = new Map();
  const problems = [];
  if (!coordinatorConfigured || !validId(nodeId)) problems.push({code:'COORDINATOR_CONFIGURATION_REQUIRED'});
  if (!session) problems.push({code:'TOURNAMENT_SESSION_REQUIRED'});
  else if (!validId(session.eventId)) problems.push({code:'INVALID_EVENT_ID'});
  for (const assignment of assignments) {
    const id=assignment?.cameraId, ring=assignment?.ring;
    let validRing=true;try{ringIdForLabel(ring);}catch{validRing=false;}
    if (!validCameraId(id) || !validRing) {problems.push({code:'INVALID_ASSIGNMENT',cameraId:typeof id==='string'?id:null});continue;}
    counts.set(id,(counts.get(id)??0)+1);
    const cameras=ringCameras.get(ring)??[];cameras.push(id);ringCameras.set(ring,cameras);
  }
  for(const [id,count] of counts) if(count>1) problems.push({code:'DUPLICATE_CAMERA_ASSIGNMENT',cameraId:id,count});
  for(const [ring,cameras] of ringCameras) if(cameras.length>1) problems.push({code:'MULTIPLE_CAMERAS_ON_RING',ring,cameraIds:cameras});
  for(const id of activeIds) if(counts.get(id)!==1) problems.push({code:'ACTIVE_CAMERA_ASSIGNMENT_MISSING_OR_DUPLICATED',cameraId:id});
  for(const id of captures) if(recordings.includes(id)) problems.push({code:'CAPTURE_RECORDING_OVERLAP',cameraId:id});
  if(activeIds.length) problems.push({code:'ACTIVE_PIPELINES_REQUIRE_RECONCILIATION',cameraIds:activeIds});
  for(const claim of claims) if(claim?.state==='uncertain' || claim?.leaseLost) problems.push({code:'UNCERTAIN_EXISTING_LEASE',ring:claim.ring??null});
  // A green preflight is NOT permission to start; the live coordinator must still grant a lease.
  return {mode:'read-only',readyForControlledIntegration:problems.length===0, eventId:session?.eventId??null,
    active:{captures,recordings,youtube}, assignmentCount:assignments.length, problems,
    safeguards:['NO_LEASE_MUTATION','NO_FFMPEG_MUTATION','ACTIVE_PIPELINES_BLOCK_ENABLEMENT']};
}
