#!/usr/bin/env node
/**
 * Tournament release acceptance. Read-only: never starts or stops a process.
 * Combines the existing fleet gate, per-host deployment reports and recorded
 * operator drill evidence. Missing evidence ALWAYS blocks approval.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_DRILLS = Object.freeze([
  'eight-camera-load', 'audio-review', 'recording-integrity',
  'usb-camera-recovery', 'youtube-relay-recovery', 'network-outage',
  'secondary-pc-failover', 'viewer-playback'
]);
const ID = /^[A-Za-z0-9_-]{1,48}$/;
const REPORT_AGE_MS = 3 * 60 * 60 * 1000;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validStamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const resolvePath = (base, input) => isAbsolute(input) ? resolve(input) : resolve(base, input);

export function validateReleasePlan(plan) {
  if (!isObject(plan) || !ID.test(plan.eventId ?? '')) throw Error('Invalid eventId');
  if (!Number.isInteger(plan.expectedCameras) || plan.expectedCameras < 1 || plan.expectedCameras > 8) throw Error('expectedCameras must be 1..8');
  if (typeof plan.gateReport !== 'string' || !plan.gateReport.trim()) throw Error('gateReport required');
  if (!Array.isArray(plan.deployments) || !plan.deployments.length || plan.deployments.length > 8) throw Error('deployments must contain 1..8 hosts');
  const hosts = new Set();
  for (const host of plan.deployments) {
    if (!isObject(host) || !ID.test(host.hostId ?? '') || hosts.has(host.hostId) || typeof host.report !== 'string' || !host.report.trim()) throw Error('Invalid or duplicate deployment host');
    hosts.add(host.hostId);
  }
  if (!Array.isArray(plan.drills)) throw Error('drills must be an array');
  const drills = new Set();
  for (const drill of plan.drills) {
    if (!isObject(drill) || !ID.test(drill.id ?? '') || drills.has(drill.id)) throw Error('Invalid or duplicate drill');
    drills.add(drill.id);
  }
  if (plan.maxAgeMinutes !== undefined && (!Number.isInteger(plan.maxAgeMinutes) || plan.maxAgeMinutes < 1 || plan.maxAgeMinutes > 10080)) throw Error('maxAgeMinutes must be 1..10080');
  return { ...plan, maxAgeMinutes: plan.maxAgeMinutes ?? 180 };
}

function checkTimestamp(value, now, ageMinutes) {
  if (!validStamp(value)) return 'missing or invalid timestamp';
  const stamp = Date.parse(value);
  if (stamp > now + 60000) return 'timestamp is in the future';
  if (now - stamp > Math.min(ageMinutes * 60000, REPORT_AGE_MS)) return 'evidence is stale';
  return null;
}

/** No file contents, operator names, URL query strings or credentials appear in results. */
export function assessRelease(planInput, documents, { now = Date.now() } = {}) {
  const plan = validateReleasePlan(planInput), checks = [];
  const check = (id, passed, detail) => checks.push({ id, status: passed ? 'pass' : 'fail', detail });
  const gate = documents?.gate;
  check('fleet-gate', isObject(gate) && gate.status === 'pass' && gate.failures === 0 && gate.warnings === 0, 'Fleet gate must pass with zero failures and warnings');
  check('camera-count', gate?.expectedCameras === plan.expectedCameras && gate?.observedCameras === plan.expectedCameras, 'Fleet gate must include every assigned camera');
  check('fleet-gate-freshness', !checkTimestamp(gate?.generatedAt, now, plan.maxAgeMinutes), 'Fleet gate must be recent');
  for (const host of plan.deployments) {
    const report = documents?.deployments?.[host.hostId];
    const p = `host-${host.hostId}`;
    check(`${p}-status`, isObject(report) && report.host === host.hostId && report.status === 'pass' && report.failures === 0 && report.warnings === 0, 'Host deployment must pass without warnings');
    check(`${p}-freshness`, !checkTimestamp(report?.generatedAt, now, plan.maxAgeMinutes), 'Host deployment must be recent');
    const phases = report?.results;
    check(`${p}-phases`, Array.isArray(phases) && ['readiness', 'stress', 'multicam', 'observer'].every(phase => phases.some(result => result?.phase === phase && result.status === 'pass')), 'All four host acceptance phases must pass');
  }
  for (const id of REQUIRED_DRILLS) {
    const drill = plan.drills.find(item => item.id === id);
    const hasEvidence = drill?.status === 'pass' && validStamp(drill.observedAt) && typeof drill.operator === 'string' && drill.operator.trim().length >= 2 && typeof drill.evidence === 'string' && drill.evidence.trim().length >= 12;
    const fresh = hasEvidence && !checkTimestamp(drill.observedAt, now, plan.maxAgeMinutes);
    check(`drill-${id}`, Boolean(fresh), `Recent operator-confirmed ${id} evidence required`);
  }
  const failures = checks.filter(item => item.status !== 'pass').length;
  return {
    schemaVersion: 1, eventId: plan.eventId, generatedAt: new Date(now).toISOString(),
    status: failures ? 'not-ready' : 'ready-for-operator-review',
    expectedCameras: plan.expectedCameras, failures, checks
  };
}

async function loadJsonWithDigest(path) {
  const bytes = await readFile(path);
  return { data: JSON.parse(bytes.toString('utf8')), digest: createHash('sha256').update(bytes).digest('hex') };
}

export async function runReleaseCheck(planPath, { outputPath, now = Date.now() } = {}) {
  const fullPath = resolve(planPath), base = dirname(fullPath);
  const plan = validateReleasePlan(JSON.parse(await readFile(fullPath, 'utf8')));
  const documents = { deployments: {} }, sources = [];
  async function load(label, path) {
    try {
      const { data, digest } = await loadJsonWithDigest(resolvePath(base, path));
      sources.push({ label, sha256: digest });
      return data;
    } catch (error) {
      // Missing/broken source cannot accidentally count as a passing report.
      sources.push({ label, error: error instanceof SyntaxError ? 'INVALID_JSON' : 'REPORT_UNAVAILABLE' });
      return null;
    }
  }
  documents.gate = await load('fleet-gate', plan.gateReport);
  for (const host of plan.deployments) documents.deployments[host.hostId] = await load(`deployment-${host.hostId}`, host.report);
  const result = { ...assessRelease(plan, documents, { now }), sources };
  if (outputPath) {
    const target = resolve(outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(result, null, 2) + '\n', { flag: 'w' });
  }
  return result;
}

export function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') { parsed.help = true; continue; }
    if (flag !== '--plan' && flag !== '--output') throw Error(`Unknown argument ${flag}`);
    if (!args[i+1] || args[i+1].startsWith('--')) throw Error(`Missing ${flag} value`);
    parsed[flag.slice(2)] = args[++i];
  }
  if (!parsed.help && !parsed.plan) throw Error('--plan required');
  return parsed;
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log('node tools/tournament-release-check.mjs --plan tools/release.example.json --output reports/release.json');
    return 0;
  }
  const result = await runReleaseCheck(parsed.plan, { outputPath: parsed.output });
  console.log(JSON.stringify({ eventId: result.eventId, status: result.status, failures: result.failures, checks: result.checks.length, output: parsed.output ?? null }, null, 2));
  return result.failures ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
