import { useState } from 'react';

type RequestNode = (url:string,options?:RequestInit)=>Promise<any>;
type ReplayReport = {scenario:string;durationMs:number;eventCount:number;incidents:Array<{node:string;ring:string;signal:string;openedAtMs:number;closedAtMs:number|null;peak:string}>;unresolved:number;expectations:{passed:number;failed:number;failures:string[]}};
const sample = {
  version:1,name:'Two-PC recovery drill',durationMs:120000,
  events:[
    {atMs:10000,node:'main',ring:'ring-1',signal:'video',state:'failed',detail:'Frozen frame'},
    {atMs:20000,node:'secondary',ring:'ring-7',signal:'audio',state:'failed',detail:'Silence'},
    {atMs:30000,node:'secondary',ring:'ring-7',signal:'youtube',state:'failed',detail:'Viewer outage'},
    {atMs:50000,node:'main',ring:'ring-1',signal:'video',state:'ok'},
    {atMs:60000,node:'secondary',ring:'ring-7',signal:'audio',state:'ok'},
    {atMs:90000,node:'secondary',ring:'ring-7',signal:'youtube',state:'ok'}
  ],expected:[
    {node:'main',ring:'ring-1',signal:'video',state:'failed',byMs:10000},
    {node:'secondary',ring:'ring-7',signal:'youtube',state:'ok',byMs:90000}
  ]
};
export function IncidentReplayPanel({requestNode}:{requestNode:RequestNode}) {
  const [scenario,setScenario]=useState(JSON.stringify(sample,null,2));
  const [report,setReport]=useState<ReplayReport|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function run() {
    setBusy(true);setError('');setReport(null);
    try {
      const parsed=JSON.parse(scenario);
      const response=await requestNode('/api/simulation/replay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed)});
      setReport(response as ReplayReport);
    } catch(e) {setError(String(e));} finally {setBusy(false);}
  }
  async function loadFile(file:File|null) {
    if(!file)return;
    if(file.size>512*1024){setError('Scenario exceeds 512 KiB');return;}
    setScenario(await file.text());setReport(null);setError('');
  }
  return <details className="session-panel compact-collapsible" aria-label="Incident replay simulator">
    <summary>Incident replay and recovery drills</summary>
    <p className="muted">Offline synthetic events only. This does not start, stop, or interfere with cameras, recordings or YouTube streams.</p>
    <label>Load scenario JSON <input type="file" accept=".json,application/json" onChange={e=>void loadFile(e.target.files?.[0]??null)}/></label>
    <textarea aria-label="Scenario JSON" value={scenario} onChange={e=>setScenario(e.target.value)} rows={10} style={{width:'100%',fontFamily:'monospace'}}/>
    <div className="camera-actions">
      <button type="button" disabled={busy} onClick={()=>void run()}>Run simulation</button>
      <button type="button" disabled={busy} onClick={()=>{setScenario(JSON.stringify(sample,null,2));setReport(null);}}>Restore sample drill</button>
      {report && <button type="button" onClick={()=>{
        const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='incident-replay-report.json';a.click();URL.revokeObjectURL(url);
      }}>Export report JSON</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p role="status"><strong>{report.scenario}</strong>: {report.eventCount} events, {report.incidents.length} incidents, {report.unresolved} unresolved, {report.expectations.failed} failed expectations.</p>
      {report.expectations.failures.map((f,i)=><p key={i} role="alert">{f}</p>)}
      <div style={{maxHeight:280,overflow:'auto'}}><table><thead><tr><th>Node</th><th>Ring</th><th>Signal</th><th>Severity</th><th>Opened</th><th>Recovered</th></tr></thead><tbody>
        {report.incidents.map((incident,i)=><tr key={i}><td>{incident.node}</td><td>{incident.ring}</td><td>{incident.signal}</td><td>{incident.peak}</td><td>{incident.openedAtMs/1000}s</td><td>{incident.closedAtMs===null?'Unresolved':`${incident.closedAtMs/1000}s`}</td></tr>)}
      </tbody></table></div>
    </>}
  </details>;
}
