import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve(process.argv[2]||'apps/dashboard/src/App.tsx');
const original=fs.readFileSync(file,'utf8');
if(original.includes('const [remoteCaptureControlsEnabled, setRemoteCaptureControlsEnabled]')){console.log('Remote capture controls already installed');process.exit(0);}
const begin=original.indexOf('function NodeDashboard({ node }: { node: NodeInfo }) {');
const end=original.indexOf('\nexport default function App()',begin);
if(begin<0||end<0)throw Error('NodeDashboard boundaries not found. No changes made.');
let block=original.slice(begin,end);
const old=`  const requestNode = useCallback((url: string, options?: RequestInit) => {\n    if (!node.local && options?.method && options.method.toUpperCase() !== "GET") {\n      return Promise.reject(new Error("Remote nodes are read-only in this dashboard. Use the capture node locally to change settings."));\n    }\n    return request(\`\${base}\${url}\`, options);\n  }, [node.local, node.id]);`;
if(!block.includes(old))throw Error('Expected remote request callback not found. No changes made.');
const replacement=`  // Remote capture commands are explicitly enabled per dashboard session, never saved.\n  const [remoteCaptureControlsEnabled, setRemoteCaptureControlsEnabled] = useState(false);\n  const remoteCaptureAllowed = node.local || remoteCaptureControlsEnabled;\n  const requestNode = useCallback((url: string, options?: RequestInit) => {\n    const method = (options?.method ?? "GET").toUpperCase();\n    if (!node.local && method !== "GET") {\n      if (!remoteCaptureControlsEnabled) return Promise.reject(new Error("Enable remote capture controls for this node first."));\n      // The server also enforces operator authentication and a strict route allowlist.\n      const allowed = method === "POST" && (/^\\/api\\/captures\\/start$/.test(url) ||\n        /^\\/api\\/captures\\/stop-all$/.test(url) || /^\\/api\\/captures\\/[^/?]+\\/stop$/.test(url) ||\n        /^\\/api\\/youtube\\/[^/?]+\\/(start|stop)$/.test(url) ||\n        /^\\/api\\/session\\/(start-all|stop-all)$/.test(url));\n      if (!allowed) return Promise.reject(new Error("This remote setting is not enabled. Use the capture node locally."));\n    }\n    return request(\`\${base}\${url}\`, options);\n  }, [base, node.local, remoteCaptureControlsEnabled]);`;
block=block.replace(old,replacement);
// Only the capture action buttons are unlocked. Device settings and testing stay local.
const targets=[
  'disabled={!node.local || !connected || busy || (!capture && (!assignedMic || micBusy))}',
  'disabled={!node.local || busy || !connected ||'
];
for(const target of targets){if(!block.includes(target))throw Error(`Expected capture button not found: ${target}`);block=block.replace(target,target.replace('!node.local','!remoteCaptureAllowed'));}
const needle='  const [connected, setConnected] = useState(false);';
if(!block.includes(needle))throw Error('NodeDashboard state anchor missing');
// Render opt-in in dashboard's top-level JSX, not inside another component.
const notice='{!node.local && <div className="readonly-notice" role="status">Remote node: read-only monitoring. Use this computer locally to control its cameras and recordings.</div>}';
if(!block.includes(notice))throw Error('Remote node notice anchor missing');
const control=`{!node.local && <section className="operator-tool-card" aria-label="Remote capture controls">
        <label><input type="checkbox" checked={remoteCaptureControlsEnabled}
          onChange={e => {
            if (e.target.checked && !window.confirm(\`Enable remote capture controls for \${node.name}? Commands may start or stop live streams and recordings.\`)) return;
            setRemoteCaptureControlsEnabled(e.target.checked);
          }} /> Enable remote capture controls for {node.name}</label>
        <p className="muted">Off by default. Requires operator authentication on the host. Do not retry timed-out start or stop commands without checking the node's current status.</p>
      </section>}`;
block=block.replace(notice,control);
const result=original.slice(0,begin)+block+original.slice(end);
const backup=file+'.pre-remote-controls-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak';
fs.copyFileSync(file,backup);const temp=file+'.remote-tmp';try{fs.writeFileSync(temp,result);fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
console.log('Remote capture control opt-in installed. Backup:',backup);
