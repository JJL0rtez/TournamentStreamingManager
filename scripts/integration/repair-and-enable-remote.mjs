import { spawnSync } from 'node:child_process';
import path from 'node:path';
const file=path.resolve(process.argv[2]||'apps/dashboard/src/App.tsx');
const root=path.dirname(new URL(import.meta.url).pathname);
for(const script of ['repair-dashboard.mjs','enable-remote-capture-controls.mjs']){
 const result=spawnSync(process.execPath,[path.join(root,script),file],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
console.log('Dashboard repair and remote control integration complete. Run typecheck and build.');
