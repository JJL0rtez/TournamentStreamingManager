import { startPolling } from "./operator-polling";
import { useEffect, useState } from "react";
type Fleet = {checkedAt:string;summary:{total:number;online:number;offline:number;nodesWithWarnings:number};
  warnings:string[];nodes:Array<{id:string;name:string;online:boolean;local:boolean;latencyMs:number|null;
  errors:string[];health:unknown;storage:unknown;captures:unknown;entitlement:unknown}>};
export function FleetReadinessPanel(){
  const [report,setReport]=useState<Fleet|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function refresh(){
    setBusy(true);
    try{
      const response=await fetch("/api/nodes/fleet-readiness",{cache:"no-store"});
      if(!response.ok)throw new Error(`Fleet readiness HTTP ${response.status}`);
      setReport(await response.json() as Fleet);setError("");
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  useEffect(()=>{const timer = startPolling(refresh, 30000);
    return ()=>timer();},[]);
  return <details className="session-panel compact-collapsible">
    <summary>Multi-computer fleet readiness {report?`(${report.summary.online}/${report.summary.total} online)`:""}</summary>
    <p>Read-only health checks. Dashboard or network loss does not stop independent camera capture.</p>
    <button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh all computers</button>
    {report && <>
      <p>Online: {report.summary.online} · Offline: {report.summary.offline} · Nodes with warnings: {report.summary.nodesWithWarnings}</p>
      <table><thead><tr><th>Computer</th><th>Status</th><th>Latency</th><th>Diagnostics</th></tr></thead><tbody>
        {report.nodes.map(node=><tr key={node.id}><td>{node.name} {node.local?"(local)":""}</td>
          <td>{node.online?"Online":"Unreachable"}</td><td>{node.latencyMs===null?"Unknown":`${node.latencyMs} ms`}</td>
          <td>{node.errors.length?node.errors.join("; "):"No remote errors"}</td></tr>)}
      </tbody></table>
      {report.warnings.map((w,i)=><p key={i} role="status">{w}</p>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
