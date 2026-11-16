/** Read-only comparison of two /api/captures snapshots. No camera or recording control. */
export type CaptureSample={cameraId:string;running?:boolean;frameCount?:number;frameAgeMs?:number|null;recordingFileSize?:number;recordingSegments?:Array<{path?:string;size?:number}>;microphoneName?:string|null;};
export type Finding={cameraId:string;code:string;level:'ok'|'warning'|'error';message:string};
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function compare(before:CaptureSample[],after:CaptureSample[],ids:string[],maxFrameAgeMs=5000):Finding[]{
 const findings:Finding[]=[];const add=(id:string,code:string,level:Finding['level'],message:string)=>findings.push({cameraId:id,code,level,message});
 const seen=new Set<string>();
 for(const id of ids){
  if(seen.has(id)){add(id,'duplicate-id','error','Duplicate selected camera ID');continue;}seen.add(id);
  const b=before.filter(x=>x.cameraId===id),a=after.filter(x=>x.cameraId===id);
  if(b.length!==1||a.length!==1){add(id,'missing-or-duplicate','error','Camera absent or duplicated in one of the snapshots');continue;}
  const first=b[0],last=a[0];
  if(!first.running||!last.running){add(id,'capture-stopped','error','Capture was not running at both observations');continue;}
  add(id,'capture-running','ok','Capture remained running');
  if(valid(first.frameCount)&&valid(last.frameCount)){
   if(last.frameCount>first.frameCount)add(id,'frames-advanced','ok',`Preview frames advanced by ${last.frameCount-first.frameCount}`);
   else if(last.frameCount<first.frameCount)add(id,'frames-reset','warning','Frame counter reset, possibly due to capture restart');
   else add(id,'frames-stalled','error','Preview frame count did not advance');
  }else add(id,'frames-unknown','warning','Frame counters unavailable');
  if(valid(last.frameAgeMs)&&last.frameAgeMs>maxFrameAgeMs)add(id,'stale-frame','error','Latest preview frame is stale');
  if(!last.microphoneName)add(id,'microphone-unset','warning','No microphone name reported for this capture');
  // Recording may be disabled: lack of bytes is a warning, not proof of a failed recording.
  if(valid(first.recordingFileSize)&&valid(last.recordingFileSize)){
   if(last.recordingFileSize>first.recordingFileSize)add(id,'recording-growing','ok',`Recording grew by ${last.recordingFileSize-first.recordingFileSize} bytes`);
   else if(last.recordingFileSize<first.recordingFileSize)add(id,'recording-size-reset','warning','Recording byte count decreased, possibly due to segment rollover');
   else add(id,'recording-unchanged','warning','Recording bytes unchanged; check whether recording is enabled and segments are finalized');
  }else add(id,'recording-unknown','warning','Recording byte counters unavailable');
  const s=last.recordingSegments;
  if(Array.isArray(s)&&s.some(x=>x.size!==undefined&&(!valid(x.size))))add(id,'invalid-segment-size','error','Recording segment contains an invalid size');
 }
 return findings;
}
export function summarize(findings:Finding[]){return {errors:findings.filter(f=>f.level==='error').length,warnings:findings.filter(f=>f.level==='warning').length,ok:findings.filter(f=>f.level==='ok').length};}
export function parseIds(raw:string){return raw.split(',').map(s=>s.trim()).filter(Boolean);}
export function validateBase(raw:string){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('API URL must be an HTTP(S) origin without credentials or path');return u.origin;}
