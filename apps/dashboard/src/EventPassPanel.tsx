import { startPolling } from "./operator-polling";
import { useCallback, useEffect, useState } from "react";

type LicenseStatus = {
  tier:"free"|"event"; reason:string; configured:boolean;
  licenseId:string|null; eventId:string|null;
  activatedAt:string|null; expiresAt:string|null;
  maxNodes:number; enforcementEnabled:boolean;
};
type RequestNode = (url:string,options?:RequestInit)=>Promise<any>;
export function EventPassPanel({requestNode,local}:{requestNode:RequestNode;local:boolean}) {
  const [status,setStatus]=useState<LicenseStatus|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const refresh=useCallback(async()=>{
    const value=await requestNode("/api/entitlement/status") as LicenseStatus;
    setStatus(value);
  },[requestNode]);
  useEffect(()=>{
    let live=true;
    const run=async()=>{
      try {
        const data=await requestNode("/api/entitlement/status") as LicenseStatus;
        if(live){setStatus(data);setError("");}
      }catch(e){if(live)setError(String(e));}
    };
    const interval = startPolling(run, 30000);
    return ()=>{live=false;interval();};
  },[requestNode]);
  async function install(){
    if(!file || loading)return;
    setLoading(true);setError("");setSuccess("");
    try {
      if(file.size>64*1024)throw new Error("Pass file exceeds 64 KiB.");
      const parsed=JSON.parse(await file.text()) as unknown;
      await requestNode("/api/entitlement/install",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parsed)
      });
      await refresh();setFile(null);
      setSuccess("Pass installed but not activated. The 10-day countdown has not started.");
    }catch(e){setError(String(e));}
    finally{setLoading(false);}
  }
  async function activate(){
    if(loading || !window.confirm("Activate this event pass now? Its 10-day window begins immediately and cannot be paused."))return;
    setLoading(true);setError("");setSuccess("");
    try {
      await requestNode("/api/entitlement/activate",{method:"POST"});
      await refresh();setSuccess("Event pass activated.");
    }catch(e){setError(String(e));}
    finally{setLoading(false);}
  }
  const pending=status?.reason==="PASS_NOT_ACTIVATED";
  return <details className="session-panel compact-collapsible" aria-label="Event pass licensing">
    <summary>Event pass licensing: {status?.tier==="event"?"Active event pass":status?.reason==="PASS_NOT_ACTIVATED"?"Installed, awaiting activation":"Free tier"}</summary>
    <p className="muted">Signed passes can be verified offline. Installation does not start the 10-day countdown.</p>
    {!status && <p role="status">Loading license status...</p>}
    {status && <>
      <p><strong>Tier:</strong> {status.tier==="event"?"Event pass":"Free"} · <strong>Reason:</strong> {status.reason}</p>
      {status.licenseId && <p><strong>License:</strong> {status.licenseId} · <strong>Event:</strong> {status.eventId}</p>}
      {status.activatedAt && <p><strong>Activated:</strong> {new Date(status.activatedAt).toLocaleString()}</p>}
      {status.expiresAt && <p><strong>New-output expiry:</strong> {new Date(status.expiresAt).toLocaleString()}</p>}
      <p className="muted">Authorized computers (signed maximum): {status.maxNodes}. Free-tier enforcement: {status.enforcementEnabled?"enabled":"not enabled on this server"}.</p>
      {!status.configured && <p role="status">License verification is not configured on this Node service. Set the server node ID and issuer public key first.</p>}
      {local && status.configured && <>
        <label>Signed event pass JSON
          <input type="file" accept=".json,application/json" disabled={loading} onChange={e=>setFile(e.target.files?.[0]??null)}/>
        </label>
        <div className="camera-actions">
          <button type="button" disabled={!file||loading} onClick={()=>void install()}>Install pass without activation</button>
          <button type="button" disabled={!pending||loading} onClick={()=>void activate()}>Activate 10-day pass</button>
        </div>
      </>}
      {!local && <p className="muted">Remote nodes are read-only. Install and activate on the capture computer.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
  </details>;
}
