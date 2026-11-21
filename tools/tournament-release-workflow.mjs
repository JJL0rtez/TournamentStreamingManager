#!/usr/bin/env node
/** Local, operator-driven release evidence workflow. Never controls streams or cameras. */
import { readFile, writeFile, copyFile, rename, unlink, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { REQUIRED_DRILLS, validateReleasePlan, runReleaseCheck } from './tournament-release-check.mjs';

const VALID_ID = /^[A-Za-z0-9_-]{1,48}$/;
const COMMANDS = new Set(['init','record','status','check']);
const FLAGS = new Set(['--from','--plan','--output','--drill','--status','--operator','--evidence','--confirm-observed']);
const VALUE_FLAGS = new Set([...FLAGS].filter(k => k !== '--confirm-observed'));

export function parseWorkflowArgs(args) {
  const [command, ...rest] = args;
  if (!COMMANDS.has(command)) throw Error('Command must be init, record, status or check');
  const options = { command };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!FLAGS.has(flag)) throw Error(`Unknown option ${flag}`);
    if (options[flag] !== undefined) throw Error(`Duplicate option ${flag}`);
    if (flag === '--confirm-observed') { options[flag] = true; continue; }
    const value = rest[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
    options[flag] = value;
  }
  const required = { init:['--output'], record:['--plan','--drill','--status'], status:['--plan'], check:['--plan','--output'] };
  const allowed = { init:['--from','--output'], record:['--plan','--drill','--status','--operator','--evidence','--confirm-observed'], status:['--plan'], check:['--plan','--output'] };
  for (const key of required[command]) if (!options[key]) throw Error(`${key} required for ${command}`);
  for (const key of Object.keys(options)) if (key !== 'command' && !allowed[command].includes(key)) throw Error(`${key} cannot be used with ${command}`);
  return options;
}

function normalizePlan(source) {
  const plan = validateReleasePlan(source);
  // Never clone an existing pass as fresh acceptance evidence for a new event.
  return { ...plan, drills: REQUIRED_DRILLS.map(id => ({ id, status:'pending', observedAt:'', operator:'', evidence:'' })) };
}

async function writeNew(path, contents) {
  await mkdir(dirname(path), {recursive:true});
  await writeFile(path, contents, {flag:'wx', mode:0o600});
}

/** Create a new event-specific file without carrying old operator approvals forward. */
export async function initializePlan(fromPath, outputPath) {
  const source = resolve(fromPath), target = resolve(outputPath);
  if (source === target) throw Error('Input and output plans must differ');
  const plan = normalizePlan(JSON.parse(await readFile(source,'utf8')));
  await writeNew(target, JSON.stringify(plan,null,2)+'\n');
  return {eventId:plan.eventId, expectedCameras:plan.expectedCameras, drillsPending:REQUIRED_DRILLS.length};
}

export function recordDrillInPlan(source, {drillId, status, operator, evidence, observedAt}) {
  const plan = validateReleasePlan(source);
  if (!REQUIRED_DRILLS.includes(drillId)) throw Error('Unknown required drill');
  if (!['pass','fail','pending'].includes(status)) throw Error('Drill status must be pass, fail or pending');
  if (status !== 'pending') {
    if (typeof operator !== 'string' || operator.trim().length < 2 || operator.length > 120) throw Error('Operator name required (2..120 characters)');
    if (typeof evidence !== 'string' || evidence.trim().length < 12 || evidence.length > 4000) throw Error('Evidence required (12..4000 characters)');
  }
  const drills = [...plan.drills], index = drills.findIndex(item => item.id === drillId);
  const item = status === 'pending' ? {id:drillId,status,observedAt:'',operator:'',evidence:''} : {id:drillId,status,observedAt,operator:operator.trim(),evidence:evidence.trim()};
  if (index === -1) drills.push(item); else drills[index] = item;
  return validateReleasePlan({...plan,drills});
}

/** An exclusive lock plus backup protects the operator's local evidence file. */
export async function recordDrill(planPath, fields, {now = Date.now()} = {}) {
  const path = resolve(planPath), lockPath = `${path}.lock`;
  const lock = await open(lockPath,'wx',0o600);
  let staged;
  try {
    const observedAt = new Date(now).toISOString();
    const before = await readFile(path, 'utf8');
    const updated = recordDrillInPlan(JSON.parse(before), {...fields,observedAt});
    const backup = `${path}.${new Date(now).toISOString().replace(/[:.]/g,'-')}.${randomUUID().slice(0,8)}.bak`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
    staged = `${path}.${randomUUID()}.tmp`;
    await writeNew(staged, JSON.stringify(updated,null,2)+'\n');
    await rename(staged,path);
    staged = undefined;
    return {drill:fields.drillId,status:fields.status,backup};
  } finally {
    if (staged) await unlink(staged).catch(()=>{});
    await lock.close();
    await unlink(lockPath).catch(()=>{});
  }
}

/** Summary is intentionally free of notes, operator identities and credentials. */
export function summarizePlan(planInput, {now=Date.now()}={}) {
  const plan = validateReleasePlan(planInput);
  const drills = REQUIRED_DRILLS.map(id => {
    const entry = plan.drills.find(item => item.id === id);
    let status = entry?.status === 'pass' || entry?.status === 'fail' ? entry.status : 'pending';
    if (status !== 'pending') {
      const at = Date.parse(entry?.observedAt ?? '');
      if (!Number.isFinite(at) || at > now+60000 || now-at > Math.min((plan.maxAgeMinutes ?? 180)*60000,3*3600000)) status='stale';
    }
    return {id,status};
  });
  return {eventId:plan.eventId,expectedCameras:plan.expectedCameras,total:drills.length,passed:drills.filter(d=>d.status==='pass').length,drills};
}

export async function main(args=process.argv.slice(2)) {
  const o = parseWorkflowArgs(args);
  if (o.command === 'init') {
    const source = o['--from'] ?? fileURLToPath(new URL('./release.example.json',import.meta.url));
    console.log(JSON.stringify(await initializePlan(source,o['--output']),null,2)); return 0;
  }
  if (o.command === 'record') {
    if (o['--status'] === 'pass' && o['--confirm-observed'] !== true) throw Error('Passing a drill requires --confirm-observed after a real-world test');
    const result = await recordDrill(o['--plan'],{drillId:o['--drill'],status:o['--status'],operator:o['--operator'],evidence:o['--evidence']});
    console.log(JSON.stringify({drill:result.drill,status:result.status,backupCreated:true},null,2)); return 0;
  }
  if (o.command === 'status') {
    console.log(JSON.stringify(summarizePlan(JSON.parse(await readFile(resolve(o['--plan']),'utf8'))),null,2)); return 0;
  }
  const report = await runReleaseCheck(o['--plan'],{outputPath:o['--output']});
  console.log(JSON.stringify({status:report.status,failures:report.failures,checks:report.checks.length},null,2));
  return report.failures ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(code => {process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=2;});
