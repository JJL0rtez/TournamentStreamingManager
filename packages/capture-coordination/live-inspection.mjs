import { randomUUID } from 'node:crypto';
import { LeaseClient } from './client.mjs';
import { validId, ringIdForLabel } from './core.mjs';

/** Read-only coordinator inspection. Never acquires, renews, releases or assumes ownership.
 * Inspection errors fail closed. Lease IDs and secrets are never returned to callers. */
export async function inspectCoordinatorRings({session, nodeId, url, secret, client, maxRings=16}={}) {
  if (!validId(nodeId) || !url || typeof secret !== 'string' || secret.length < 32)
    return {verified:false, code:'COORDINATOR_CONFIGURATION_REQUIRED', rings:[]};
  if (!session || !validId(session.eventId) || !Array.isArray(session.assignments))
    return {verified:false, code:'TOURNAMENT_SESSION_REQUIRED', rings:[]};
  const ringIds=[...new Set(session.assignments.map(a=>a?.ring))];
  let wireIds;
  try { wireIds=ringIds.map(ringIdForLabel); } catch {return {verified:false, code:'INVALID_RING_ASSIGNMENTS', rings:[]};}
  if (!ringIds.length || ringIds.length > maxRings)
    return {verified:false, code:'INVALID_RING_ASSIGNMENTS', rings:[]};
  const leaseClient=client ?? new LeaseClient({url,secret,timeoutMs:2000});
  const rings=[];
  // Sequential, bounded requests avoid hammering a degraded coordinator.
  for (const [index,ringId] of ringIds.entries()) {
    try {
      const response=await leaseClient.inspect({eventId:session.eventId,ringId:wireIds[index],nodeId,sessionId:randomUUID()});
      if (response?.ok !== true) {
        rings.push({ringId,verified:false,code:'INSPECT_REJECTED'});
      } else {
        const lease=response.lease;
        rings.push({ringId,verified:true,occupied:Boolean(lease),ownerNodeId:lease?.nodeId??null,
          expired:lease ? Number(lease.expiresAt)<=Date.now() : false});
      }
    } catch {
      rings.push({ringId,verified:false,code:'COORDINATOR_UNREACHABLE'});
    }
  }
  const verified=rings.every(r=>r.verified);
  return {verified,code:verified?'INSPECTION_COMPLETE':'INSPECTION_INCOMPLETE',rings,
    safeToEnable:false, note:'Inspection does not grant ownership or authorize FFmpeg startup'};
}
