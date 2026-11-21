import { observerCredentialsConfigured } from "./playback-observer-auth.js";
/** Independent playback observations from separately deployed, untrusted workers.
 * Reports are diagnostic only. They never establish YouTube platform health.
 */
export type PlaybackCamera = { cameraId: string; checkedAt: string; status: 'healthy' | 'warning'; framesDecoded: number; freezeEvents: number; blackEvents: number; silenceEvents: number; issues: string[]; playbackTransportChecked: boolean };
export type PlaybackReport = { schemaVersion: 1; observerId?: string; checkedAt: string; source: 'independent-ffmpeg-playback'; youtubePlatformVerified: false; cameras: PlaybackCamera[] };
const reports = new Map<string, PlaybackReport>();
const validId = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_OBSERVERS = 16;
const MAX_AGE_MS = 90_000;
const MAX_SKEW_MS = 120_000;

export function acceptPlaybackObservation(input: unknown, now = Date.now()): boolean {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<PlaybackReport>;
  const observerId = value.observerId ?? 'default'; // Backward compatibility with v7 workers.
  if (typeof observerId !== 'string' || !validId.test(observerId) ||
      value.schemaVersion !== 1 || value.source !== 'independent-ffmpeg-playback' || value.youtubePlatformVerified !== false ||
      !Array.isArray(value.cameras) || value.cameras.length < 1 || value.cameras.length > 8) return false;
  const time = Date.parse(String(value.checkedAt ?? ''));
  if (!Number.isFinite(time) || Math.abs(now - time) > MAX_SKEW_MS) return false;
  const old = reports.get(observerId);
  // A delayed network packet must never replace newer observations.
  if (old && time < Date.parse(old.checkedAt)) return false;
  const seen = new Set<string>();
  const cameras: PlaybackCamera[] = [];
  for (const item of value.cameras) {
    if (!item || typeof item.cameraId !== 'string' || !validId.test(item.cameraId) || seen.has(item.cameraId) ||
        !['healthy','warning'].includes(item.status) ||
        ![item.framesDecoded,item.freezeEvents,item.blackEvents,item.silenceEvents].every(n => Number.isInteger(n) && n >= 0 && n <= 10_000_000) ||
        !Array.isArray(item.issues) || item.issues.length > 12 || !item.issues.every(s => typeof s === 'string' && s.length <= 160) ||
        item.playbackTransportChecked !== true ||
        (item.status === 'healthy' && (item.issues.length > 0 || item.framesDecoded === 0 || item.freezeEvents + item.blackEvents + item.silenceEvents > 0)) ||
        typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt)) || Math.abs(now - Date.parse(item.checkedAt)) > MAX_SKEW_MS ||
        Math.abs(time - Date.parse(item.checkedAt)) > MAX_SKEW_MS) return false;
    seen.add(item.cameraId);
    // Copy only explicitly permitted fields; secrets and media URLs cannot be exposed.
    cameras.push({ cameraId:item.cameraId, checkedAt:item.checkedAt, status:item.status, framesDecoded:item.framesDecoded,
      freezeEvents:item.freezeEvents, blackEvents:item.blackEvents, silenceEvents:item.silenceEvents, issues:[...item.issues], playbackTransportChecked:true });
  }
  // Remove expired entries before evaluating the bounded observer capacity.
  for (const [id, report] of reports) if (now - Date.parse(report.checkedAt) > MAX_SKEW_MS) reports.delete(id);
  if (!reports.has(observerId) && reports.size >= MAX_OBSERVERS) return false;
  reports.set(observerId, {schemaVersion:1, observerId, checkedAt:value.checkedAt!, source:'independent-ffmpeg-playback', youtubePlatformVerified:false, cameras});
  return true;
}

export function getPlaybackObservation(now = Date.now()) {
  const observers = [...reports.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([observerId, report]) => {
    const ageMs = now - Date.parse(report.checkedAt);
    const stale = ageMs < 0 || ageMs > MAX_AGE_MS;
    return {observerId, stale, ageMs, status:stale ? 'unknown' as const : 'observed' as const,
      checkedAt:report.checkedAt, cameras:stale ? [] : report.cameras.map(c => ({...c, observerId}))};
  });
  const fresh = observers.filter(item => !item.stale);
  const byCamera = new Map<string,number>();
  for (const observer of fresh) for (const camera of observer.cameras) byCamera.set(camera.cameraId,(byCamera.get(camera.cameraId) ?? 0)+1);
  const conflictingCameraIds = [...byCamera].filter(([,count]) => count > 1).map(([id])=>id).sort();
  const cameras = fresh.flatMap(observer => observer.cameras.map(camera => ({...camera,
    // Cross-worker identity collisions are never reported as unambiguous healthy playback.
    status: conflictingCameraIds.includes(camera.cameraId) ? 'warning' as const : camera.status,
    issues: conflictingCameraIds.includes(camera.cameraId) ? [...camera.issues, 'Duplicate camera ID reported by multiple observers'] : [...camera.issues]})));
  const stale = fresh.length === 0;
  // Maintain v7 top-level fields for existing dashboards and clients.
  const single = fresh.length === 1 ? reports.get(fresh[0].observerId)! : null;
  const report = stale ? null : {schemaVersion:1 as const, checkedAt:single?.checkedAt ?? new Date(Math.max(...fresh.map(o => Date.parse(o.checkedAt)))).toISOString(),
    source:'independent-ffmpeg-playback' as const, youtubePlatformVerified:false as const, cameras};
  return {enabled:observerCredentialsConfigured(),
    stale, ageMs:stale ? null : Math.min(...fresh.map(o=>o.ageMs)), status:stale ? 'unknown' : 'observed', report,
    observers, conflictingCameraIds, youtubePlatformVerified:false,
    note:'Independent FFmpeg playback transport observation only. YouTube platform health is not verified.'};
}
