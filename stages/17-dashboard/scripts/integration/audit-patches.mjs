import fs from 'node:fs';
import path from 'node:path';
import { repairSource } from './repair-dashboard.mjs';

const root=path.resolve(process.argv[2]||'.');
const exists=p=>fs.existsSync(path.join(root,p));
const checks=[
 ['Dashboard source','apps/dashboard/src/App.tsx'],
 ['Node API','apps/node-service/src/api.ts'],
 ['Remote node transport','apps/node-service/src/remote-nodes.ts'],
 ['Distributed coordinator','packages/capture-coordination/server.mjs'],
 ['Unified capture integration','apps/node-service/src/unified-capture-integration.ts'],
 ['Capture safety','scripts/windows/check-capture-restart.mjs'],
 ['Replay simulator','apps/node-service/src/incident-replay.ts'],
 ['Event pass issuer','scripts/issue-event-pass.mjs']
];
const report={generatedAt:new Date().toISOString(),root,checks:checks.map(([name,file])=>({name,file,present:exists(file)})),warnings:[]};
if(exists('apps/dashboard/src/App.tsx')) {
 const source=fs.readFileSync(path.join(root,'apps/dashboard/src/App.tsx'),'utf8');
 const analysis=repairSource(source);
 report.checks.push({name:'React hook import consistency',file:'apps/dashboard/src/App.tsx',present:!analysis.fixes.length,details:analysis.fixes});
 report.warnings.push(...analysis.warnings);
 report.checks.push({name:'Remote capture opt-in',file:'apps/dashboard/src/App.tsx',present:source.includes('remoteCaptureControlsEnabled')});
}
if(exists('apps/node-service/src/api.ts')){
 const source=fs.readFileSync(path.join(root,'apps/node-service/src/api.ts'),'utf8');
 report.checks.push({name:'Unified capture API integration',file:'apps/node-service/src/api.ts',present:source.includes('unified-capture-integration')||source.includes('installUnifiedCapture')||source.includes('unifiedCapture')});
}
report.present=report.checks.filter(c=>c.present).length;
report.total=report.checks.length;
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--strict') && report.present!==report.total)process.exitCode=1;
