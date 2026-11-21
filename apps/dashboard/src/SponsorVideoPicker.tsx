import { presentationFetch } from "./presentation-api";
import { useRef, useState } from "react";
export { sponsorFileLabel } from "./sponsor-timing";
import { sponsorFileLabel } from "./sponsor-timing";
export function SponsorVideoPicker({value="",fileName,addOnly=false,onChange}:{value?:string;fileName?:string;addOnly?:boolean;onChange:(url:string,name?:string)=>void}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [externalUrl,setExternalUrl]=useState("");
  const inFlight=useRef(false);
  async function upload(file:File){
    if(inFlight.current)return;
    const type=/\.mp4$/i.test(file.name)?"video/mp4":/\.webm$/i.test(file.name)?"video/webm":"";
    if(!type||file.size<12||file.size>200*1024*1024){setError("Choose an MP4 or WebM file up to 200 MB.");return;}
    inFlight.current=true;setBusy(true);setError("");
    try{
      const response=await presentationFetch("/api/tournament-displays/media",{method:"POST",headers:{"Content-Type":type},body:file});
      const result=await response.json();
      if(!response.ok||typeof result.url!=="string")throw new Error(result.error||`Upload failed (${response.status})`);
      onChange(result.url,file.name);
    }catch(cause){setError(String(cause));}finally{inFlight.current=false;setBusy(false);}
  }
  return <div className="ts-sponsor-file">
    <label>{addOnly?"Add sponsor video":"Sponsor video file"}<input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void upload(file);}}/></label>
    {busy&&<span role="status">Uploading video…</span>}
    {!addOnly&&value&&<div className="ts-sponsor-row"><span>{sponsorFileLabel(value,fileName,0)}</span><button type="button" onClick={()=>onChange("")}>Remove video</button></div>}
    {!addOnly&&<details><summary>Use an external video instead</summary><label>Direct HTTPS media address<input type="url" placeholder="https://example.com/sponsor.mp4" value={externalUrl} onChange={e=>setExternalUrl(e.target.value)}/></label><button type="button" disabled={busy||!externalUrl.trim()} onClick={()=>{try{const parsed=new URL(externalUrl.trim());if(parsed.protocol!=="https:"||parsed.username||parsed.password||!/\.(mp4|webm)$/i.test(parsed.pathname))throw Error("Enter a direct HTTPS MP4 or WebM address.");onChange(parsed.href);setExternalUrl("");setError("");}catch(cause){setError(String(cause));}}}>Use external video</button></details>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
