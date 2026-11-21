import {useEffect,useMemo,useRef,useState} from 'react';
import './TournamentDisplayExtras.css';
import { SponsorPlayback } from './SponsorPlayback';
export type ScheduleRow={event:string;time:string};
export type ScheduleRing={ring:string;rows:ScheduleRow[]};
export type DisplayConfig={schedule:ScheduleRing[];cameraSeconds:number;motionThreshold:number;sponsorEvery:number;sponsorVideos:string[]};
const STORAGE='tournament-display-extras-v1';
export const DEFAULT_DISPLAY:DisplayConfig={schedule:[],cameraSeconds:20,motionThreshold:12,sponsorEvery:3,sponsorVideos:[]};
export function readDisplayConfig():DisplayConfig{try{const v=JSON.parse(localStorage.getItem(STORAGE)||'null');if(v&&Array.isArray(v.schedule)&&Array.isArray(v.sponsorVideos))return {...DEFAULT_DISPLAY,...v};}catch{}return DEFAULT_DISPLAY;}
function saveConfig(v:DisplayConfig){localStorage.setItem(STORAGE,JSON.stringify(v));window.dispatchEvent(new Event('tournament-display-config'));}
export function ScheduleDisplay({rings,eventName}:{rings:ScheduleRing[];eventName:string}){return <section className="td-schedule"><h1>{eventName} | Ring Assignments</h1><div className="td-schedule-grid">{rings.map((ring,i)=><table key={`${ring.ring}-${i}`}><thead><tr><th colSpan={2}>{ring.ring}</th></tr></thead><tbody>{ring.rows.map((r,j)=><tr key={j}><td>{r.event}</td><td>{r.time}</td></tr>)}</tbody></table>)}</div></section>;}

type Camera={cameraId:string;cameraName:string;ring:string};
type Sample={score:number;updated:number};
// Compare small centre crops from existing feeds, never open a DirectShow input.
function centrePixels(img:ImageBitmap):Uint8ClampedArray{const c=document.createElement('canvas');c.width=48;c.height=48;const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas unavailable');const w=img.width,h=img.height;const side=Math.min(w,h)*.5;ctx.drawImage(img,(w-side)/2,(h-side)/2,side,side,0,0,48,48);return ctx.getImageData(0,0,48,48).data;}
function difference(a:Uint8ClampedArray,b:Uint8ClampedArray){let sum=0;for(let i=0;i<a.length;i+=4)sum+=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;return sum/(a.length/4);}
export function CameraRotation({cameras,config,fullscreen=false}:{cameras:Camera[];config:DisplayConfig;fullscreen?:boolean}){
 const [samples,setSamples]=useState<Record<string,Sample>>({});
 const [selected,setSelected]=useState('');
 const [pinned,setPinned]=useState('');
 const [sponsor,setSponsor]=useState(-1);
 const [visible,setVisible]=useState(!document.hidden);
 const [feedAttempt,setFeedAttempt]=useState(0);
 const [feedFailed,setFeedFailed]=useState(false);
 const last=useRef(new Map<string,Uint8ClampedArray>());
 const due=useRef(0);const changes=useRef(0);
 const cameraIds=useMemo(()=>cameras.map(c=>c.cameraId).join('\u0001'),[cameras]);
 useEffect(()=>{const update=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 // All requests are read-only. Closing, hiding or leaving the view releases its network requests;
 // manually started previews and production captures remain under their original operator's control.
 useEffect(()=>{
   if(!visible){setSamples({});last.current.clear();return;}
   let active=true;let controller:AbortController|null=null;let timer:ReturnType<typeof setTimeout>|undefined;
   const allowed=new Set(cameraIds.split('\u0001').filter(Boolean));
   async function poll(){
     controller=new AbortController();const signal=controller.signal;
     const timeout=setTimeout(()=>controller?.abort(),5000);
     try{
       const result=await fetch('/api/display-sources',{cache:'no-store',signal});
       if(!result.ok)throw Error('Display sources unavailable');
       const data=await result.json();
       const ids:string[]=Array.isArray(data.cameraIds)?[...new Set<string>(data.cameraIds.filter((id:unknown):id is string=>typeof id==='string'&&allowed.has(id)))].slice(0,8):[];
       const next:Record<string,Sample>={};
       // Motion probes only read existing buffered frames; inactive cameras are never started.
       await Promise.all(ids.map(async id=>{try{
         const r=await fetch(`/api/display-frame/${encodeURIComponent(id)}`,{cache:'no-store',signal});if(!r.ok)return;
         const img=await createImageBitmap(await r.blob());
         try{if(!active||signal.aborted)return;const pixels=centrePixels(img);const prev=last.current.get(id);next[id]={score:prev?difference(prev,pixels):0,updated:Date.now()};last.current.set(id,pixels);}finally{img.close();}
       }catch{/* unavailable feed is excluded */}}));
       if(active&&!signal.aborted){for(const id of last.current.keys())if(!next[id])last.current.delete(id);setSamples(next);}
       else if(active)setSamples({});
     }catch{if(active)setSamples({});}
     finally{clearTimeout(timeout);if(active)timer=setTimeout(()=>void poll(),2000);}
   }
   void poll();return()=>{active=false;controller?.abort();if(timer)clearTimeout(timer);last.current.clear();};
 },[cameraIds,visible]);
 useEffect(()=>{
   if(!visible||sponsor>=0)return;
   const ready=cameras.filter(c=>samples[c.cameraId]&&Date.now()-samples[c.cameraId].updated<8000);
   if(pinned){if(selected!==pinned){setSelected(pinned);setFeedAttempt(n=>n+1);setFeedFailed(false);}return;}
   if(!ready.length){if(selected)setSelected('');return;}
   if(ready.some(c=>c.cameraId===selected)&&Date.now()<due.current)return;
   const eligible=ready.filter(c=>samples[c.cameraId].score>=config.motionThreshold);
   const ranked=[...(eligible.length?eligible:ready)].sort((a,b)=>samples[b.cameraId].score-samples[a.cameraId].score);
   const next=ranked.find(c=>c.cameraId!==selected)||ranked[0];
   if(next.cameraId!==selected){setSelected(next.cameraId);setFeedAttempt(n=>n+1);setFeedFailed(false);if(selected){changes.current++;if(config.sponsorEvery>0&&config.sponsorVideos.length&&changes.current%config.sponsorEvery===0)setSponsor((Math.floor(changes.current/config.sponsorEvery)-1)%config.sponsorVideos.length);}}
   due.current=Date.now()+config.cameraSeconds*1000;
 },[cameras,samples,visible,pinned,selected,sponsor,config.cameraSeconds,config.motionThreshold,config.sponsorEvery,config.sponsorVideos]);
 // A failed MJPEG connection is retried only while the camera is still available.
 useEffect(()=>{if(!visible||!selected||sponsor>=0)return;if(!feedFailed)return;const t=setTimeout(()=>{setFeedAttempt(n=>n+1);setFeedFailed(false);},3000);return()=>clearTimeout(t);},[selected,visible,sponsor,feedFailed]);
 function finishSponsor(){setSponsor(-1);due.current=Date.now()+config.cameraSeconds*1000;}
 const shown=cameras.find(c=>c.cameraId===selected&&samples[c.cameraId]);
 return <section className="td-camera">
 {!fullscreen&&<div className="td-display-selector"><label>Camera display <select value={pinned} onChange={e=>{setPinned(e.target.value);setSponsor(-1);due.current=0;}}><option value="">Automatic rotation</option>{cameras.map(c=><option key={c.cameraId} value={c.cameraId} disabled={!samples[c.cameraId]}>{c.ring} ({c.cameraName}){!samples[c.cameraId]?' - inactive':''}</option>)}</select></label></div>}
 {!visible?null:sponsor>=0?<SponsorPlayback key={`${sponsor}:${config.sponsorVideos[sponsor]}`} src={config.sponsorVideos[sponsor]} onFinish={finishSponsor} className="td-video"/>:shown&&!feedFailed?<img key={`${shown.cameraId}:${feedAttempt}`} src={`/api/display-live/${encodeURIComponent(shown.cameraId)}?attempt=${feedAttempt}`} alt={`Live camera ${shown.ring}`} className="td-preview" onError={()=>setFeedFailed(true)}/>:<p>{!cameras.length?'No assigned cameras.':shown?'Reconnecting to camera feed...':pinned?'Selected camera is inactive. Start its preview, recording or stream from the dashboard.':'No active camera feeds. Start a preview, recording or stream from the dashboard.'}</p>}
 </section>;
}
export function DisplayConfigEditor({config,onChange}:{config:DisplayConfig;onChange:(v:DisplayConfig)=>void}){function update(v:DisplayConfig){onChange(v);saveConfig(v);}return <section className="td-editor"><h3>Legacy local display settings</h3><p>Camera rotation and ring slides are configured in their dedicated editors.</p><button onClick={()=>update(DEFAULT_DISPLAY)}>Reset local legacy settings</button></section>;}
