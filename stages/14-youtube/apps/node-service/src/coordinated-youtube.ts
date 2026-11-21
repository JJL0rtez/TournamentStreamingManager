import { randomUUID } from 'node:crypto';
import type { YouTubeStreamManager } from './YouTubeStreamManager.js';
import { getSession } from './tournament-session.js';
// The coordinator is a plain ESM package shared by the CLI and Node service.
// @ts-ignore The coordinator's JavaScript API is validated by integration tests.
import { LeaseClient, CaptureLeaseGuard } from '../../../packages/capture-coordination/client.mjs';

type LeaseGuard = { acquire(): Promise<unknown>; startHeartbeat(): void; release(): Promise<void>; lost: boolean };
type GuardedSession = { guard: LeaseGuard; eventId: string; ring: string; sessionId: string; state: 'starting'|'active'|'stopping'|'uncertain' };

/** One process-wide controller. A start remains reserved until stop and lease release succeed. */
export class CoordinatedYouTube {
  private sessions = new Map<string, GuardedSession>();
  private pending = new Set<string>();
  private client: InstanceType<typeof LeaseClient> | null;
  private readonly nodeId: string;
  constructor(private readonly relays: YouTubeStreamManager, options: {url?: string; secret?: string; nodeId?: string; client?: InstanceType<typeof LeaseClient>} = {}) {
    const url = options.url ?? process.env.TSM_COORDINATOR_URL;
    const secret = options.secret ?? process.env.TSM_COORDINATOR_SECRET;
    this.client = options.client ?? (url && secret && secret.length >= 32 ? new LeaseClient({url, secret}) : null);
    this.nodeId = options.nodeId ?? process.env.TSM_NODE_ID ?? '';
  }
  private identity(cameraId: string) {
    if (!this.client) throw Error('COORDINATOR_NOT_CONFIGURED: configure TSM_COORDINATOR_URL and TSM_COORDINATOR_SECRET before streaming');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(this.nodeId)) throw Error('TSM_NODE_ID_REQUIRED');
    const session = getSession();
    if (!session) throw Error('TOURNAMENT_SESSION_REQUIRED');
    const matches = session.assignments.filter(a => a.cameraId === cameraId);
    if (matches.length !== 1) throw Error('CAMERA_RING_ASSIGNMENT_REQUIRED');
    const ring = matches[0].ring;
    // Coordinator identifiers are strict. Stable ring normalization is shared across nodes.
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(ring)) throw Error('RING_ID_MUST_BE_ALPHANUMERIC');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(session.eventId)) throw Error('INVALID_EVENT_ID');
    return {eventId: session.eventId, ringId: ring, nodeId: this.nodeId, sessionId: randomUUID()};
  }
  async start(cameraId: string, streamKey: string): Promise<void> {
    if (this.pending.has(cameraId) || this.sessions.has(cameraId) || this.relays.get(cameraId)) throw Error('RELAY_ALREADY_ACTIVE_OR_RESERVED');
    this.pending.add(cameraId);
    try {
      const identity = this.identity(cameraId);
      const guard: LeaseGuard = new CaptureLeaseGuard(this.client, identity, {onLeaseLost: (error: Error) => {
        const record = this.sessions.get(cameraId);
        if (record) record.state = 'uncertain';
        console.error(`Coordinator heartbeat lost for ${cameraId}: ${error.message}. Existing relay is NOT terminated.`);
      }});
      await guard.acquire();
      const record: GuardedSession = {guard, eventId: identity.eventId, ring: identity.ringId, sessionId: identity.sessionId, state: 'starting'};
      this.sessions.set(cameraId, record);
      try {
        this.relays.start(cameraId, streamKey);
        record.state = 'active';
        guard.startHeartbeat();
      } catch (error) {
        // If FFmpeg spawn state is uncertain, retain the claim instead of releasing it.
        if (this.relays.get(cameraId)) {record.state = 'uncertain'; throw error;}
        try {await guard.release(); this.sessions.delete(cameraId);} catch {record.state = 'uncertain';}
        throw error;
      }
    } finally {this.pending.delete(cameraId);}
  }
  async stop(cameraId: string): Promise<boolean> {
    if (this.pending.has(cameraId)) throw Error('RELAY_OPERATION_IN_PROGRESS');
    this.pending.add(cameraId);
    try {
      const record = this.sessions.get(cameraId);
      if (!record) {
        // A relay that is not owned by this controller must not be silently stopped/released.
        if (this.relays.get(cameraId)) throw Error('UNTRACKED_RELAY_REQUIRES_MANUAL_RECOVERY');
        return false;
      }
      record.state = 'stopping';
      await this.relays.stop(cameraId);
      // Only release after stop is confirmed. On failure the lease remains reserved.
      try {await record.guard.release(); this.sessions.delete(cameraId);}
      catch (error) {record.state = 'uncertain'; throw error;}
      return true;
    } catch (error) {
      const record = this.sessions.get(cameraId);
      if (record) record.state = 'uncertain';
      throw error;
    } finally {this.pending.delete(cameraId);}
  }
  async stopAll(): Promise<void> {
    const ids = new Set([...this.sessions.keys(), ...this.relays.list().map(s => s.cameraId)]);
    const results = await Promise.allSettled([...ids].map(id => this.stop(id)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(f => f.reason), `${failures.length} relay stop(s) failed`);
  }
  status() {return [...this.sessions.entries()].map(([cameraId, r]) => ({cameraId, eventId:r.eventId, ring:r.ring, state:r.state, leaseLost:r.guard.lost}));}
}
