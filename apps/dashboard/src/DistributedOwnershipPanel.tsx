import { startPolling } from "./operator-polling";
import { useEffect, useState } from "react";

type Ring = {ringKey:string;state?:string;leaseLost?:boolean;requiresReconciliation?:boolean;members?:string[]};
type Ownership = {enabled:boolean;youtubeEnabled?:boolean;rings:Ring[]};
type CaptureReconciliation = {enabled:boolean;untrackedRunning:string[];trackedNotRunning:string[];uncertainRings:string[];safeToEnable:boolean};
type Relay = {cameraId:string;state:string;manualRestartEligible?:boolean};
type RelayReconciliation = {enabled:boolean;safe:boolean;relays:Relay[];uncertainRings:string[]};
type Snapshot = {ownership:Ownership;capture:CaptureReconciliation;relay:RelayReconciliation;checkedAt:number};

/** Read-only view. A status refresh must never acquire/release a lease or restart FFmpeg. */
export function DistributedOwnershipPanel({requestNode,connected}:{requestNode:(url:string,options?:RequestInit)=>Promise<any>;connected:boolean}) {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let live=true;
    async function refresh(){
      if(!connected){if(live){setSnapshot(null);setError("Node disconnected");}return;}
      try {
        const [ownership,capture,relay] = await Promise.all([
          requestNode("/api/captures/distributed-ownership"),
          requestNode("/api/captures/distributed-reconciliation"),
          requestNode("/api/youtube/distributed-reconciliation")
        ]) as [Ownership,CaptureReconciliation,RelayReconciliation];
        if(live){setSnapshot({ownership,capture,relay,checkedAt:Date.now()});setError(null);}
      }catch(e){if(live){setSnapshot(null);setError(String(e));}}
    }
    const timer = startPolling(refresh, 5000);
    return()=>{live=false;timer();};
  },[requestNode,connected]);
  const ownership=snapshot?.ownership;
  const capture=snapshot?.capture;
  const relay=snapshot?.relay;
  const problems=(capture?.untrackedRunning.length||0)+(capture?.trackedNotRunning.length||0)+(capture?.uncertainRings.length||0)+
    (relay?.relays.filter(item=>item.state!=="healthy-local").length||0);
  return <details className="session-panel compact-collapsible" aria-label="Distributed ownership diagnostics">
    <summary>Distributed ownership {error?"(unavailable)":!ownership?.enabled?"(disabled)":problems?`(${problems} warnings)`:"(active)"}</summary>
    <p className="muted">Read-only status from this capture PC. A green status is not proof that YouTube viewers receive healthy video.</p>
    {error?<p role="alert">Status unavailable: {error}</p>:!snapshot?<p>Waiting for status...</p>:<>
      <p>Last checked: {new Date(snapshot.checkedAt).toLocaleTimeString()} · Capture coordination: {ownership?.enabled?"enabled":"disabled"} · Relay coordination: {ownership?.youtubeEnabled?"enabled":"disabled"}</p>
      {ownership?.enabled&&<>
        <p>Tracked rings: {ownership.rings.length} · Capture reconciliation: {capture?.safeToEnable?"clear":"needs attention"}</p>
        {!!capture?.untrackedRunning.length&&<p role="alert">Running but untracked captures: {capture.untrackedRunning.join(", ")}</p>}
        {!!capture?.trackedNotRunning.length&&<p role="alert">Tracked captures not running: {capture.trackedNotRunning.join(", ")}</p>}
        {!!capture?.uncertainRings.length&&<p role="alert">Rings requiring reconciliation: {capture.uncertainRings.join(", ")}</p>}
        {ownership.rings.map((ring,index)=><p key={`${ring.ringKey}-${index}`}>{ring.ringKey}: {ring.state||"unknown"}{ring.leaseLost?" · lease lost":""}{ring.requiresReconciliation?" · reconciliation required":""} · {(ring.members||[]).join(", ")||"no members"}</p>)}
      </>}
      {relay?.enabled&&<>
        <h4>YouTube relay ownership</h4>
        {!relay.relays.length?<p>No relays tracked.</p>:relay.relays.map(item=><p key={item.cameraId}>{item.cameraId}: {item.state}{item.manualRestartEligible?" · manual restart may be eligible":""}</p>)}
        {!!relay.uncertainRings.length&&<p role="alert">Uncertain relay rings: {relay.uncertainRings.join(", ")}</p>}
      </>}
    </>}
  </details>;
}
