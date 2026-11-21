/** Bounded restart policy for independent observer processes. No server or stream mutations. */
export const SUPERVISION = Object.freeze({ maxRestarts: 5, windowMs: 10 * 60_000, baseDelayMs: 2000, maxDelayMs: 30_000, healthyResetMs: 10 * 60_000 });

export function nextObserverRestart(attempts, now, uptimeMs, policy = SUPERVISION) {
  if (!Number.isFinite(now) || !Number.isFinite(uptimeMs) || uptimeMs < 0 || !Array.isArray(attempts)) throw new Error('Invalid supervisor state');
  const relevant = uptimeMs >= policy.healthyResetMs ? [] : attempts.filter(t => Number.isFinite(t) && t <= now && now - t < policy.windowMs);
  if (relevant.length >= policy.maxRestarts) return {allowed: false, reason:'Observer exceeded restart limit', attempts:relevant, delayMs:null};
  const delayMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** relevant.length);
  return {allowed:true, attempts:[...relevant,now], delayMs, reason:null};
}
