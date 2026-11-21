import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function repairSource(source) {
  let out = source;
  const fixes = [];
  const reactImports = [...out.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']react["']\s*;/g)];
  const usedHooks = ['useCallback','useEffect','useMemo','useRef','useState','useReducer','useLayoutEffect','useId','useContext','useImperativeHandle','useTransition','useDeferredValue','useSyncExternalStore'].filter(name => new RegExp(`\\b${name}\\s*\\(`).test(out));
  const imported = new Set(reactImports.flatMap(m => m[1].split(',').map(v=>v.trim().split(/\s+as\s+/)[0])));
  const missing = usedHooks.filter(name => !imported.has(name) && !new RegExp(`(?:React|react)\\.${name}\\s*\\(`).test(out));
  if (missing.length) {
    if (reactImports.length) {
      const m=reactImports[0];
      const next=m[0].replace(m[1], m[1].trim().replace(/,\s*$/, '') + ', ' + missing.join(', '));
      out=out.slice(0,m.index)+next+out.slice(m.index+m[0].length);
    } else {
      out=`import { ${missing.join(', ')} } from "react";\n`+out;
    }
    fixes.push(`Added missing React hooks: ${missing.join(', ')}`);
  }
  const hasNodeDashboard = /function NodeDashboard\s*\(/.test(out);
  const hasReadOnly = /Remote nodes are read-only in this dashboard/.test(out);
  return {source:out,fixes,warnings:[...(hasNodeDashboard && hasReadOnly ? ['Legacy read-only remote callback detected: apply enable-remote-capture-controls.mjs if remote controls are intended.'] : [])]};
}

export function applyFile(file, {check=false}={}) {
  const original=fs.readFileSync(file,'utf8');
  const result=repairSource(original);
  if (!check && result.source!==original) {
    const backup=`${file}.pre-dashboard-repair-${new Date().toISOString().replace(/[:.]/g,'-')}.bak`;
    fs.copyFileSync(file,backup);
    const tmp=`${file}.repair-${process.pid}.tmp`;
    try {fs.writeFileSync(tmp,result.source);fs.renameSync(tmp,file);} catch(err) {try{fs.unlinkSync(tmp);}catch{}throw err;}
    result.backup=backup;
  }
  return {...result,changed:result.source!==original};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const check=args.includes('--check');
  const file=path.resolve(args.find(v=>!v.startsWith('--'))||'apps/dashboard/src/App.tsx');
  try {
    const result=applyFile(file,{check});
    for(const line of result.fixes)console.log('FIX:',line);
    for(const line of result.warnings)console.warn('WARNING:',line);
    if(result.backup)console.log('Backup:',result.backup);
    if(!result.changed)console.log('React hook imports already consistent.');
    if(check && result.changed)process.exitCode=1;
  } catch(e){console.error(e.message);process.exitCode=2;}
}
