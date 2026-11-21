import { timingSafeEqual } from 'node:crypto';

const observerIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_OBSERVERS = 16;

/** Configured per-worker tokens take precedence over the legacy shared token.
 * Malformed configuration fails closed, never falls back to the shared token.
 */
export function observerCredentialsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TSM_PLAYBACK_OBSERVER_TOKENS !== undefined) {
    return parseObserverTokens(env.TSM_PLAYBACK_OBSERVER_TOKENS) !== null;
  }
  return (env.TSM_PLAYBACK_OBSERVER_TOKEN ?? '').length >= 32;
}

export function parseObserverTokens(raw: string): Map<string, string> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value);
    if (entries.length === 0 || entries.length > MAX_OBSERVERS) return null;
    const secrets = new Set<string>();
    const result = new Map<string, string>();
    for (const [observerId, token] of entries) {
      if (!observerIdPattern.test(observerId) || typeof token !== 'string' || token.length < 32 || token.length > 512 || secrets.has(token)) return null;
      secrets.add(token);
      result.set(observerId, token);
    }
    return result;
  } catch { return null; }
}

function equalToken(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Authorize only the observer identity named inside the submitted report. */
export function authorizePlaybackObserver(body: unknown, supplied: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof supplied !== 'string' || supplied.length < 32 || supplied.length > 512 || !body || typeof body !== 'object') return false;
  const report = body as { observerId?: unknown };
  if (env.TSM_PLAYBACK_OBSERVER_TOKENS !== undefined) {
    const tokens = parseObserverTokens(env.TSM_PLAYBACK_OBSERVER_TOKENS);
    if (!tokens || typeof report.observerId !== 'string') return false;
    const expected = tokens.get(report.observerId);
    return expected !== undefined && equalToken(supplied, expected);
  }
  const expected = env.TSM_PLAYBACK_OBSERVER_TOKEN;
  if (!expected || expected.length < 32 || expected.length > 512) return false;
  return equalToken(supplied, expected);
}
