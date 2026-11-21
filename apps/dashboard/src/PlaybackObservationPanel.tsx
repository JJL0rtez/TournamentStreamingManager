import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from 'react';
type Camera = {observerId?:string;cameraId:string;status:'healthy'|'warning';checkedAt:string;framesDecoded:number;issues:string[]};
type Observation = {enabled:boolean;stale:boolean;status:string;report:null|{checkedAt:string;cameras:Camera[]};observers?:{observerId:string;stale:boolean;ageMs:number;checkedAt:string}[];conflictingCameraIds?:string[];youtubePlatformVerified:false;note:string};
export function PlaybackObservationPanel({request}:{request:(path:string)=>Promise<any>}) {
  const [status,setStatus] = useState<Observation|null>(null);
  const [error,setError] = useState('');
  const refresh=useCallback(async()=>{try {setStatus(await request('/api/operations/playback-observation'));setError('');} catch {setError('Observer telemetry unavailable');setStatus(null);}},[request]);
  useEffect(()=>{const interval = startPolling(refresh, 15000);return()=>interval();},[refresh]);
  return <details className="operator-tool-card" aria-label="Independent playback observer"><summary><strong>Independent playback observer</strong> (read-only)</summary>
    <p className="muted">Optional external FFmpeg worker checks playback media decoding, freezes, black frames and silence. It does not authenticate with YouTube or establish platform ingest health.</p>
    <button type="button" onClick={()=>void refresh()}>Refresh observer</button>
    {error ? <p role="alert">{error}</p> : !status?.enabled ? <p>Observer ingestion is not configured.</p> : status.stale ? <p role="status">No recent observer report. Playback state unknown.</p> : <>
      <p>Last independent check: {status.report?.checkedAt}. YouTube platform verification: unavailable.</p>
      {status.observers && <p>Observers: {status.observers.filter(o=>!o.stale).length} reporting, {status.observers.filter(o=>o.stale).length} stale.</p>}
      {!!status.conflictingCameraIds?.length && <p role="alert">Duplicate camera identities across observers: {status.conflictingCameraIds.join(', ')}. Verify worker assignments.</p>}
      {status.observers?.filter(o=>o.stale).map(o=><p key={o.observerId} role="status">Observer {o.observerId}: report stale, camera state unknown.</p>)}
      <div style={{overflowX:'auto'}}><table><thead><tr><th>Observer</th><th>Camera</th><th>Playback</th><th>Frames decoded</th><th>Issues</th></tr></thead><tbody>
      {status.report?.cameras.map(camera=><tr key={`${camera.observerId ?? "default"}:${camera.cameraId}`}><td>{camera.observerId ?? "default"}</td><td>{camera.cameraId}</td><td>{camera.status}</td><td>{camera.framesDecoded}</td><td>{camera.issues.join('; ')||'No decoder issues'}</td></tr>)}
      </tbody></table></div>
    </>}
  </details>;
}
