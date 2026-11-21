#!/usr/bin/env node
// TournamentStreamingManager offline and opt-in network preflight. Node 20+.
import { stat, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function runCommand(program, args, {timeoutMs = 12000, spawnFn = spawn} = {}) {
  return new Promise((resolveResult) => {
    let child, stdout = '', stderr = '', settled = false;
    const finish = result => { if (!settled) { settled = true; resolveResult(result); } };
    try { child = spawnFn(program, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'] }); }
    catch (e) { finish({ok:false, error:String(e)}); return; }
    const timer = setTimeout(() => { child.kill(); finish({ok:false,error:'TIMEOUT'}); }, timeoutMs);
    child.stdout?.on('data', b => { stdout = (stdout + b.toString()).slice(-3000); });
    child.stderr?.on('data', b => { stderr = (stderr + b.toString()).slice(-3000); });
    child.on('error', e => { clearTimeout(timer); finish({ok:false,error:e.code || e.message}); });
    child.on('close', code => { clearTimeout(timer); finish({ok:code===0,code,stdout,stderr}); });
  });
}
export function parseArgs(argv) {
  const opts = { recordings:[], endpoints:[], minFreeGb:25, sampleLimit:20, report:'readiness-report.json', probeMedia:false };
  for (let i=0; i<argv.length; i++) {
    const arg=argv[i], value=argv[i+1];
    if (arg==='--recordings' || arg==='--endpoint' || arg==='--report' || arg==='--min-free-gb' || arg==='--sample-limit') {
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`);
      if (arg==='--recordings') opts.recordings.push(resolve(value));
      if (arg==='--endpoint') opts.endpoints.push(value);
      if (arg==='--report') opts.report=resolve(value);
      if (arg==='--min-free-gb') opts.minFreeGb=Number(value);
      if (arg==='--sample-limit') opts.sampleLimit=Number(value);
      i++; continue;
    }
    if (arg==='--probe-media') { opts.probeMedia=true; continue; }
    if (arg==='--help') { opts.help=true; continue; }
    throw Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.minFreeGb) || opts.minFreeGb<0) throw Error('Invalid --min-free-gb');
  if (!Number.isSafeInteger(opts.sampleLimit) || opts.sampleLimit<1 || opts.sampleLimit>200) throw Error('Invalid --sample-limit');
  for (const url of opts.endpoints) {
    const u=new URL(url);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('Endpoint must be an HTTP(S) URL without credentials or query parameters');
  }
  return opts;
}
export function summarize(checks) {
  const failures=checks.filter(x=>x.status==='fail').length;
  const warnings=checks.filter(x=>x.status==='warn').length;
  return { status:failures?'fail':warnings?'warn':'pass', failures, warnings, passed:checks.filter(x=>x.status==='pass').length };
}
const check=(name,status,detail)=>({name,status,detail});
export async function inspectRecordings(directories, {sampleLimit=20,probeMedia=false,command=runCommand}={}) {
  const checks=[];
  for (const directory of directories) {
    let entries;
    try { entries=await readdir(directory,{withFileTypes:true}); }
    catch (e) { checks.push(check('recordings-directory','fail',`${directory}: ${e.code||'UNAVAILABLE'}`));continue; }
    const media=entries.filter(e=>e.isFile()&&['.mkv','.mp4','.mov'].includes(extname(e.name).toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,sampleLimit);
    if (!media.length) { checks.push(check('recordings-directory','warn',`${directory}: no top-level media files found`));continue; }
    for (const item of media) {
      const path=resolve(directory,item.name);
      const metadata=await stat(path);
      if (metadata.size===0) {checks.push(check('recording-file','fail',`${item.name}: empty file`));continue;}
      if (!probeMedia) {checks.push(check('recording-file','warn',`${item.name}: ${metadata.size} bytes; media not probed`));continue;}
      const probe=await command('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',path],{timeoutMs:15000});
      if (!probe.ok) {checks.push(check('recording-file','fail',`${item.name}: ffprobe failed (${probe.error||probe.code})`));continue;}
      try {
        const result=JSON.parse(probe.stdout);
        const video=result.streams?.find(x=>x.codec_type==='video');
        const duration=Number(result.format?.duration);
        checks.push(check('recording-file',video&&Number.isFinite(duration)&&duration>0?'pass':'fail',`${item.name}: duration=${Number.isFinite(duration)?duration.toFixed(2):'unknown'}s video=${video?.codec_name||'missing'}`));
      } catch {checks.push(check('recording-file','fail',`${item.name}: invalid ffprobe JSON`));}
    }
  }
  return checks;
}
export async function inspectEndpoints(urls, {fetchFn=fetch,timeoutMs=5000}={}) {
  const checks=[];
  for (const url of urls) {
    // Avoid exposing query strings, credentials, or response bodies in reports.
    const u=new URL(url);const label=`${u.origin}${u.pathname}`;
    try {
      const response=await fetchFn(url,{method:'GET',signal:AbortSignal.timeout(timeoutMs),redirect:'manual'});
      checks.push(check('network-endpoint',response.ok?'pass':'fail',`${label}: HTTP ${response.status}`));
    } catch(e) {checks.push(check('network-endpoint','fail',`${label}: ${e.name==='TimeoutError'?'TIMEOUT':'UNREACHABLE'}`));}
  }
  return checks;
}
export async function runReadiness(opts,{command=runCommand,fetchFn=fetch,freeSpaceFn}={}) {
  const checks=[];
  for (const tool of ['node','ffmpeg','ffprobe']) {
    const result=await command(tool,['-version'],{timeoutMs:8000});
    checks.push(check(`${tool}-available`,result.ok?'pass':'fail',result.ok?'Executable available':result.error||`Exit ${result.code}`));
  }
  for (const dir of opts.recordings) {
    try {
      const info=await stat(dir);
      if (!info.isDirectory()) {checks.push(check('recordings-path','fail',`${dir}: not a directory`));continue;}
      if (freeSpaceFn) {
        const bytes=await freeSpaceFn(dir);
        const gb=bytes/1e9;
        checks.push(check('disk-free',''+(gb>=opts.minFreeGb?'pass':'fail'),`${dir}: ${gb.toFixed(1)} GB free (minimum ${opts.minFreeGb} GB)`));
      } else {
        // Node's statfs is supported on modern Node versions, including Windows.
        const {statfs}=await import('node:fs/promises');
        const fs=await statfs(dir,{bigint:true});
        const gb=Number(fs.bavail*fs.bsize)/1e9;
        checks.push(check('disk-free',gb>=opts.minFreeGb?'pass':'fail',`${dir}: ${gb.toFixed(1)} GB free (minimum ${opts.minFreeGb} GB)`));
      }
    } catch(e) {checks.push(check('disk-free','fail',`${dir}: ${e.code||'UNAVAILABLE'}`));}
  }
  checks.push(...await inspectRecordings(opts.recordings,{sampleLimit:opts.sampleLimit,probeMedia:opts.probeMedia,command}));
  checks.push(...await inspectEndpoints(opts.endpoints,{fetchFn}));
  const summary=summarize(checks);
  return {schemaVersion:1,generatedAt:new Date().toISOString(),host:process.env.COMPUTERNAME||process.env.HOSTNAME||'unknown',summary,checks,limitations:['No camera/USB capture load test','No sustained disk write benchmark','No YouTube ingestion verification','No real coordinator failover validation']};
}
export async function main(argv=process.argv.slice(2)) {
  const opts=parseArgs(argv);
  if (opts.help) {console.log('Usage: node tools/tournament-readiness.mjs [--recordings DIRECTORY] [--probe-media] [--endpoint URL] [--min-free-gb N] [--sample-limit N] [--report FILE]');return 0;}
  const report=await runReadiness(opts);
  await mkdir(dirname(resolve(opts.report)),{recursive:true});
  await writeFile(opts.report,JSON.stringify(report,null,2)+'\n');
  console.log(`Readiness: ${report.summary.status.toUpperCase()} (${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failures} failed). Report: ${opts.report}`);
  return report.summary.failures?1:0;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e.message);process.exitCode=2;});
}
