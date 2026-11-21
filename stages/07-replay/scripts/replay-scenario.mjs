#!/usr/bin/env node
// Offline replay runner. No cameras, streams, network calls or FFmpeg processes.
import { readFile, writeFile } from 'node:fs/promises';
// Node 22+ supports TypeScript type stripping for source modules, but not all
// installations have the flag enabled. Use --experimental-strip-types.
const {runIncidentReplay,compareReplayReports}=await import('../apps/node-service/src/incident-replay.ts');
const [command,...args]=process.argv.slice(2);
try {
  if(command==='run' && (args.length===1 || args.length===2)) {
    const report=runIncidentReplay(JSON.parse(await readFile(args[0],'utf8')));
    if(args[1]) await writeFile(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({scenario:report.scenario,events:report.eventCount,incidents:report.incidents.length,unresolved:report.unresolved,expectations:report.expectations},null,2));
    if(report.expectations.failed)process.exitCode=1;
  } else if(command==='compare' && args.length===2) {
    const base=runIncidentReplay(JSON.parse(await readFile(args[0],'utf8')));
    const candidate=runIncidentReplay(JSON.parse(await readFile(args[1],'utf8')));
    const result=compareReplayReports(base,candidate);
    console.log(JSON.stringify(result,null,2));
    if(result.regressed)process.exitCode=1;
  } else { console.error('Usage: node --experimental-strip-types scripts/replay-scenario.mjs run scenario.json [report.json]'); console.error('       node --experimental-strip-types scripts/replay-scenario.mjs compare baseline.json candidate.json');process.exitCode=2; }
} catch(e) {console.error(e);process.exitCode=1;}
