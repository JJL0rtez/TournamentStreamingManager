/** Pure, credential-free checks for concurrent capture and relay health. */
export type Capture = { cameraId: string; running?: boolean; recordingFileSize?: number; segmentCount?: number; recordingSegments?: Array<{path?:string;size?:number}>; frameStats?: {frameAgeMs?:number|null}; };
export type Relay = {cameraId:string;status?:string;progressAgeMs?:number|null;error?:string|null};
export type Finding = {cameraId:string;code:string;level:'error'|'warning'|'ok';message:string};
export function audit(captures:Capture[], relays:Relay[], requested:string[], staleMs=15000):Finding[] {
 const findings:Finding[]=[];
 const add=(id:string,code:string,level:Finding['level'],message:string)=>findings.push({cameraId:id,code,level,message});
 const seen=new Set<string>();
 for(const id of requested){
  if(seen.has(id)){add(id,'duplicate-selection','error','Camera selected more than once');continue;} seen.add(id);
  const matches=captures.filter(c=>c.cameraId===id);
  if(matches.length!==1){add(id,'capture-identity','error',matches.length?'Duplicate capture identities':'Capture not found');continue;}
  const c=matches[0];
  if(!c.running){add(id,'capture-stopped','error','Local capture is not running');continue;}
  add(id,'capture-running','ok','Local capture running');
  if(typeof c.recordingFileSize==='number' && c.recordingFileSize===0 && !c.segmentCount)add(id,'recording-empty','warning','No recording bytes reported yet');
  const matchingRelays=relays.filter(r=>r.cameraId===id);
  if(matchingRelays.length>1){add(id,'duplicate-relay','error','Multiple relays report the same camera');continue;}
  const relay=matchingRelays[0];
  if(!relay){add(id,'relay-missing','warning','No active YouTube relay');continue;}
  if(relay.status==='error'||relay.error)add(id,'relay-error','error','Relay reports an error');
  else if(relay.progressAgeMs!=null&&relay.progressAgeMs>staleMs)add(id,'relay-stalled','error','Relay output progress is stale');
  else if(relay.progressAgeMs==null)add(id,'relay-connecting','warning','No outgoing progress reported yet');
  else add(id,'relay-progress','ok','Relay output progress is recent (YouTube ingest unverified)');
 }
 for(const r of relays)if(!seen.has(r.cameraId))add(r.cameraId,'unexpected-relay','warning','Relay active outside selected cameras');
 return findings;
}
export function parseCameraIds(raw:string):string[]{return raw.split(',').map(s=>s.trim()).filter(Boolean);}
export function validateUrl(raw:string):string{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Use an HTTP(S) API base URL without credentials or query parameters');return u.origin;}
export function summarize(findings:Finding[]){return {errors:findings.filter(f=>f.level==='error').length,warnings:findings.filter(f=>f.level==='warning').length,ok:findings.filter(f=>f.level==='ok').length};}
