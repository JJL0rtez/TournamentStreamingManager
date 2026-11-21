import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from 'react';

type Camera = {cameraId:string;broadcast:string;ingest:string;health:string;issues:string[]};
type PlatformReport = {enabled:boolean;checkedAt:string|null;stale:boolean;status:string;message:string;cameras:Camera[]};

/** YouTube API metadata, deliberately independent of local FFmpeg and playback-observer states. */
export function YouTubePlatformHealthPanel({request}:{request:(path:string)=>Promise<any>}) {
  const [report,setReport] = useState<PlatformReport|null>(null);
  const [error,setError] = useState('');
  const refresh = useCallback(async()=>{
    try {
      const response:PlatformReport = await request('/api/operations/youtube-platform-health');
      setReport(response);setError('');
    } catch {setReport(null);setError('YouTube platform status unavailable');}
  },[request]);
  useEffect(()=>{const id = startPolling(refresh, 60000);return()=>id();},[refresh]);
  return <details className="operator-tool-card" aria-label="YouTube platform health">
    <summary><strong>YouTube platform health</strong> (read-only)</summary>
    <p className="muted">Authenticated YouTube API broadcast lifecycle and ingest health. This is not proof of viewer playback or valid video/audio.</p>
    <button type="button" onClick={()=>void refresh()}>Refresh YouTube health</button>
    {error ? <p role="alert">{error}</p> : !report ? <p>Loading YouTube status...</p> : !report.enabled ? <p>OAuth status monitoring is not configured. {report.message}</p> : <>
      <p role="status">Status: {report.stale?'unknown (stale or unavailable)':report.status}. {report.message}</p>
      {report.checkedAt && <p>Last API check: {report.checkedAt}</p>}
      <div style={{overflowX:'auto'}}><table><thead><tr><th>Camera</th><th>Broadcast</th><th>Ingest</th><th>YouTube health</th><th>Issues</th></tr></thead><tbody>
        {report.cameras.map(camera=><tr key={camera.cameraId}><td>{camera.cameraId}</td><td>{camera.broadcast}</td><td>{camera.ingest}</td><td>{camera.health}</td><td>{camera.issues.join('; ')||'No API issues reported'}</td></tr>)}
      </tbody></table></div>
    </>}
  </details>;
}
