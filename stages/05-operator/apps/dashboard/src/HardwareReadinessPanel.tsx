import { useEffect, useState } from "react";

type RequestNode = (url:string,options?:RequestInit)=>Promise<any>;
type Plan = {cameras:number;recordingMbpsPerCamera:number;streamMbpsPerCamera:number;hours:number;safetyFactor:number};
type StorageResult = {
  plan: Plan & {estimatedBytes:number;reservedBytes:number;writeMiBps:number;
    recommendedWriteMiBps:number;uploadMbps:number;recommendedUploadMbps:number;
    capacityEnough:boolean|null;throughputEnough:boolean|null;freeBytes:number|null;
    measuredWriteMiBps:number|null};
  warnings:string[]; directory:string; benchmarkRunning:boolean;
};
type UsbDevice = {instanceId:string;friendlyName:string;className:string|null;
  controllerRoot:string|null;physicalPortPath:string|null;mappingConfidence:string};
type UsbReport = {supported:boolean;devices:UsbDevice[];warnings:string[]};
type UsbChange = {instanceId:string;type:string;[key:string]:unknown};
export function HardwareReadinessPanel({requestNode,local}:{requestNode:RequestNode;local:boolean}){
  const [plan,setPlan]=useState<Plan>({cameras:8,recordingMbpsPerCamera:8,
    streamMbpsPerCamera:6,hours:10,safetyFactor:1.5});
  const [storage,setStorage]=useState<StorageResult|null>(null);
  const [usb,setUsb]=useState<UsbReport|null>(null);
  const [changes,setChanges]=useState<{baselinePresent:boolean;changes:UsbChange[]}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [info,setInfo]=useState("");
  const format=(bytes:number|null)=>bytes===null?"unknown":`${(bytes/(1024**3)).toFixed(1)} GiB`;
  async function refreshStorage(){
    const q=new URLSearchParams(Object.entries(plan).map(([k,v])=>[k,String(v)]));
    setStorage(await requestNode(`/api/storage/readiness?${q}`) as StorageResult);
  }
  async function refreshUsb(){
    const result=await requestNode("/api/usb/topology?refresh=1") as UsbReport;
    setUsb(result);
    setChanges(await requestNode("/api/usb/topology/changes"));
  }
  async function action(run:()=>Promise<void>){
    if(busy)return;setBusy(true);setError("");setInfo("");
    try{await run();}catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    let live=true;
    void requestNode("/api/storage/readiness").then((v:StorageResult)=>{if(live)setStorage(v);}).catch(()=>{});
    void requestNode("/api/usb/topology").then((v:UsbReport)=>{if(live)setUsb(v);}).catch(()=>{});
    return ()=>{live=false;};
  },[requestNode]);
  const field=(key:keyof Plan,label:string,min:number,max:number,step:number)=>
    <label style={{display:"inline-flex",gap:6,alignItems:"center",marginRight:12}}>
      {label}<input type="number" min={min} max={max} step={step} value={plan[key]}
      style={{width:80}} onChange={e=>setPlan(p=>({...p,[key]:Number(e.target.value)}))}/>
    </label>;
  return <details className="session-panel compact-collapsible" aria-label="Hardware readiness">
    <summary>Hardware readiness: recording drive and USB topology</summary>
    <h3>Recording workload</h3>
    <div className="field" style={{display:"flex",flexWrap:"wrap",gap:8}}>
      {field("cameras","Cameras",1,128,1)}
      {field("recordingMbpsPerCamera","Record Mbps",0.1,250,0.5)}
      {field("streamMbpsPerCamera","Stream Mbps",0,100,0.5)}
      {field("hours","Hours",0.1,72,0.5)}
      {field("safetyFactor","Margin",1,4,0.1)}
    </div>
    <button type="button" disabled={busy} onClick={()=>void action(refreshStorage)}>Calculate workload</button>
    {storage && <>
      <p><strong>Recording directory:</strong> {storage.directory}</p>
      <p><strong>Estimated storage:</strong> {format(storage.plan.estimatedBytes)} ·
        <strong> With margin:</strong> {format(storage.plan.reservedBytes)} ·
        <strong> Free:</strong> {format(storage.plan.freeBytes)}</p>
      <p><strong>Required write:</strong> {storage.plan.recommendedWriteMiBps.toFixed(1)} MiB/s ·
        <strong> Measured:</strong> {storage.plan.measuredWriteMiBps===null?"Not measured":`${storage.plan.measuredWriteMiBps.toFixed(1)} MiB/s`} ·
        <strong> Upload with margin:</strong> {storage.plan.recommendedUploadMbps.toFixed(1)} Mbps</p>
      <p role="status">Capacity: {storage.plan.capacityEnough===null?"Unknown":storage.plan.capacityEnough?"Pass":"Insufficient"} ·
        Disk throughput: {storage.plan.throughputEnough===null?"Unverified":storage.plan.throughputEnough?"Pass":"Below target"}</p>
      {storage.warnings.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
    </>}
    {local && <button type="button" disabled={busy} onClick={()=>void action(async()=>{
      if(!window.confirm("Run a 64 MiB temporary-file disk benchmark? Do not run during a live tournament."))return;
      await requestNode("/api/storage/benchmark",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sampleMiB:64})});
      await refreshStorage();setInfo("Disk benchmark finished. Results updated.");
    })}>Run disk write benchmark (64 MiB)</button>}
    <h3>USB physical topology</h3>
    <button type="button" disabled={busy} onClick={()=>void action(refreshUsb)}>Scan USB ports</button>
    {local && <button type="button" disabled={busy} onClick={()=>void action(async()=>{
      await requestNode("/api/usb/topology/baseline",{method:"POST"});
      await refreshUsb();setInfo("USB baseline captured for this Node session.");
    })}>Save USB baseline</button>}
    {usb && <>
      <p>{usb.supported?`${usb.devices.length} Windows PnP devices found`:"USB topology discovery is only available on Windows."}</p>
      <div style={{maxHeight:320,overflow:"auto"}}>
        <table><thead><tr><th>Device</th><th>Class</th><th>Controller</th><th>Port path</th></tr></thead>
        <tbody>{usb.devices.map(x=><tr key={x.instanceId}>
          <td title={x.instanceId}>{x.friendlyName}</td><td>{x.className??"Unknown"}</td>
          <td>{x.controllerRoot??"Unmapped"}</td><td>{x.physicalPortPath??"Unavailable"}</td>
        </tr>)}</tbody></table>
      </div>
      {usb.warnings.map((w,i)=><p className="muted" key={i}>{w}</p>)}
    </>}
    {changes && <p role="status">USB baseline: {changes.baselinePresent?"Available":"Not captured"} ·
      Changes: {changes.changes.length}</p>}
    {changes?.changes.map((c,i)=><p key={i}>{c.type}: {c.instanceId}</p>)}
    {error && <p role="alert">{error}</p>}
    {info && <p role="status">{info}</p>}
  </details>;
}
