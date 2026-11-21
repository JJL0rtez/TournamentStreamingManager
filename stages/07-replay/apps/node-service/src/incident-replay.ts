/** Deterministic, offline-only incident simulation. Never starts cameras or FFmpeg. */
export type Signal = 'video' | 'audio' | 'encoder' | 'youtube' | 'network' | 'disk';
export type State = 'ok' | 'degraded' | 'failed';
export type ReplayEvent = { atMs: number; node: string; ring: string; signal: Signal; state: State; detail?: string };
export type ReplayScenario = { version: 1; name: string; durationMs: number; events: ReplayEvent[]; expected?: ReplayExpectation[] };
export type ReplayExpectation = { node: string; ring: string; signal: Signal; state: State; byMs: number };
export type ReplayIncident = { node: string; ring: string; signal: Signal; openedAtMs: number; closedAtMs: number | null; peak: State; details: string[] };
export type ReplayReport = { scenario: string; durationMs: number; eventCount: number; incidents: ReplayIncident[]; unresolved: number; expectations: { passed: number; failed: number; failures: string[] }; timeline: Array<{ atMs: number; activeIncidents: number; node: string; ring: string; signal: Signal; state: State }> };
const signals = new Set<Signal>(['video','audio','encoder','youtube','network','disk']);
const states = new Set<State>(['ok','degraded','failed']);
const ident = /^[a-zA-Z0-9_-]{1,64}$/;
export function validateReplayScenario(input: unknown): ReplayScenario {
  if (!input || typeof input !== 'object') throw new Error('Scenario must be an object');
  const s = input as ReplayScenario;
  if (s.version !== 1 || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 120) throw new Error('Invalid scenario header');
  if (!Number.isSafeInteger(s.durationMs) || s.durationMs < 1 || s.durationMs > 7 * 86400000) throw new Error('Invalid duration');
  if (!Array.isArray(s.events) || s.events.length > 10000) throw new Error('Invalid event count');
  for (const e of s.events) {
    if (!e || !Number.isSafeInteger(e.atMs) || e.atMs < 0 || e.atMs > s.durationMs ||
      !ident.test(e.node) || !ident.test(e.ring) || !signals.has(e.signal) || !states.has(e.state) ||
      (e.detail !== undefined && (typeof e.detail !== 'string' || e.detail.length > 500))) throw new Error('Invalid replay event');
  }
  if (s.expected !== undefined) {
    if (!Array.isArray(s.expected) || s.expected.length > 1000) throw new Error('Invalid expectations');
    for (const e of s.expected) if (!e || !ident.test(e.node) || !ident.test(e.ring) || !signals.has(e.signal) || !states.has(e.state) || !Number.isSafeInteger(e.byMs) || e.byMs < 0 || e.byMs > s.durationMs) throw new Error('Invalid expectation');
  }
  return s;
}
const severity = (state: State) => state === 'failed' ? 2 : state === 'degraded' ? 1 : 0;
const keyOf = (e: { node: string; ring: string; signal: Signal }) => `${e.node}\u0000${e.ring}\u0000${e.signal}`;
export function runIncidentReplay(input: unknown): ReplayReport {
  const s = validateReplayScenario(input);
  const events = s.events.map((event, index) => ({ event, index })).sort((a,b) => a.event.atMs - b.event.atMs || a.index - b.index);
  const active = new Map<string, ReplayIncident>();
  const incidents: ReplayIncident[] = [];
  const timeline: ReplayReport['timeline'] = [];
  for (const {event:e} of events) {
    const key = keyOf(e), existing = active.get(key);
    if (e.state === 'ok') {
      if (existing) { existing.closedAtMs = e.atMs; active.delete(key); }
    } else if (!existing) {
      const incident: ReplayIncident = { node:e.node, ring:e.ring, signal:e.signal, openedAtMs:e.atMs, closedAtMs:null, peak:e.state, details:e.detail?[e.detail]:[] };
      incidents.push(incident); active.set(key,incident);
    } else {
      if (severity(e.state) > severity(existing.peak)) existing.peak = e.state;
      if (e.detail) existing.details.push(e.detail);
    }
    timeline.push({ atMs:e.atMs, activeIncidents:active.size, node:e.node, ring:e.ring, signal:e.signal, state:e.state });
  }
  const failures:string[] = [];
  for (const expected of s.expected ?? []) {
    const found = s.events.some(e => keyOf(e) === keyOf(expected) && e.state === expected.state && e.atMs <= expected.byMs);
    if (!found) failures.push(`${expected.node}/${expected.ring}/${expected.signal}: expected ${expected.state} by ${expected.byMs}ms`);
  }
  return { scenario:s.name, durationMs:s.durationMs, eventCount:s.events.length, incidents, unresolved:active.size,
    expectations:{passed:(s.expected?.length??0)-failures.length,failed:failures.length,failures}, timeline };
}
export function compareReplayReports(base: ReplayReport, candidate: ReplayReport) {
  const baseFailures=base.expectations.failed, newFailures=candidate.expectations.failed;
  const baseUnresolved=base.unresolved, newUnresolved=candidate.unresolved;
  return { baseline:base.scenario,candidate:candidate.scenario,
    expectationFailuresDelta:newFailures-baseFailures,unresolvedDelta:newUnresolved-baseUnresolved,
    regressed:newFailures>baseFailures || newUnresolved>baseUnresolved,
    improved:newFailures<baseFailures || newUnresolved<baseUnresolved };
}
