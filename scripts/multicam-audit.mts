/** Read-only multi-camera audit. Never starts or stops a camera, relay, or recording. */
import {audit,parseCameraIds,summarize,validateUrl} from './multicam-audit-lib.mts';
const args=process.argv.slice(2);
const value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const help=args.includes('--help');
if(help){console.log('Usage: npm run multicam:audit -- --cameras ID1,ID2 [--url http://127.0.0.1:3001] [--seconds 20]');process.exit(0);}
const ids=parseCameraIds(value('--cameras')||'');
if(!ids.length){console.error('Specify logical camera IDs with --cameras ID1,ID2');process.exit(2);}
const base=validateUrl(value('--url')||process.env.TOURNAMENT_API_URL||'http://127.0.0.1:3001');
const seconds=Number(value('--seconds')||'0');
if(!Number.isInteger(seconds)||seconds<0||seconds>120){console.error('--seconds must be an integer from 0 to 120');process.exit(2);}
async function fetchJson(route:string){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);try{const res=await fetch(base+route,{signal:controller.signal,headers:{accept:'application/json'}});if(!res.ok)throw Error(`${route}: HTTP ${res.status}`);return await res.json() as any;}finally{clearTimeout(timeout);}}
async function snapshot(){const [c,r]=await Promise.all([fetchJson('/api/captures'),fetchJson('/api/youtube/streams')]);if(!Array.isArray(c.captures)||!Array.isArray(r.streams))throw Error('Unexpected API response');const findings=audit(c.captures,r.streams,ids);const summary=summarize(findings);console.log(JSON.stringify({at:new Date().toISOString(),selected:ids,summary,findings,youtubeVerified:false},null,2));return summary.errors;}
try{let errors=await snapshot();if(seconds){await new Promise(resolve=>setTimeout(resolve,seconds*1000));errors+=await snapshot();}if(errors)process.exitCode=1;}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
