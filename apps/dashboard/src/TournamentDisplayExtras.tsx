import {useEffect,useMemo,useRef,useState} from 'react';
import './TournamentDisplayExtras.css';
export type ScheduleRow={event:string;time:string};
export type ScheduleRing={ring:string;rows:ScheduleRow[]};
export type DisplayConfig={schedule:ScheduleRing[];cameraSeconds:number;motionThreshold:number;sponsorEvery:number;sponsorVideos:string[]};
const STORAGE='tournament-display-extras-v1';
export const DEFAULT_DISPLAY:DisplayConfig={schedule:[],cameraSeconds:20,motionThreshold:12,sponsorEvery:3,sponsorVideos:[]};
export function readDisplayConfig():DisplayConfig{try{const v=JSON.parse(localStorage.getItem(STORAGE)||'null');if(v&&Array.isArray(v.schedule)&&Array.isArray(v.sponsorVideos))return {...DEFAULT_DISPLAY,...v};}catch{}return DEFAULT_DISPLAY;}
function saveConfig(v:DisplayConfig){localStorage.setItem(STORAGE,JSON.stringify(v));window.dispatchEvent(new Event('tournament-display-config'));}
export function ScheduleDisplay({rings,eventName}:{rings:ScheduleRing[];eventName:string}){return <section className="td-schedule"><h1>{eventName} | Ring Assignments</h1><div className="td-schedule-grid">{rings.map((ring,i)=><table key={`${ring.ring}-${i}`}><thead><tr><th colSpan={2}>{ring.ring}</th></tr></thead><tbody>{ring.rows.map((r,j)=><tr key={j}><td>{r.event}</td><td>{r.time}</td></tr>)}</tbody></table>)}</div></section>;}

type Camera={cameraId:string;cameraName:string;ring:string};
type Sample={url:string;score:number;updated:number;status:'ready'|'starting'|'error';error?:string};
const jpegUrl=(id:string)=>`/api/previews/${encodeURIComponent(id)}/frame?ts=${Date.now()}`;
// A low-resolution centre crop is compared against the previous sample for the same camera.
function centrePixels(img:HTMLImageElement):Uint8ClampedArray{const c=document.createElement('canvas');c.width=48;c.height=48;const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas unavailable');const w=img.naturalWidth,h=img.naturalHeight;const side=Math.min(w,h)*.5;ctx.drawImage(img,(w-side)/2,(h-side)/2,side,side,0,0,48,48);return ctx.getImageData(0,0,48,48).data;}
function difference(a:Uint8ClampedArray,b:Uint8ClampedArray){let sum=0;for(let i=0;i<a.length;i+=4)sum+=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;return sum/(a.length/4);}
export function CameraRotation({cameras,config}:{cameras:Camera[];config:DisplayConfig}){
 const [samples,setSamples]=useState<Record<string,Sample>>({});
 const [selected,setSelected]=useState('');
 const [sponsor,setSponsor]=useState(-1);
 const [message,setMessage]=useState('Starting camera previews...');
 const last=useRef(new Map<string,Uint8ClampedArray>());
 const current=useRef('');const due=useRef(Date.now());const changes=useRef(0);const busy=useRef(false);
 const cameraIds=useMemo(()=>cameras.map(c=>c.cameraId).join('\u0001'),[cameras]);
 const cameraRef=useRef(cameras);cameraRef.current=cameras;
 const samplesRef=useRef(samples);samplesRef.current=samples;
 const sponsorRef=useRef(sponsor);sponsorRef.current=sponsor;
 useEffect(()=>{const available=cameraRef.current;if(!available.some(c=>c.cameraId===current.current)){current.current=available[0]?.cameraId||'';setSelected(current.current);due.current=Date.now()+config.cameraSeconds*1000;}},[cameraIds,config.cameraSeconds]);
 // Start independent preview processes on the server. This does not start YouTube streams or recordings.
 useEffect(()=>{let active=true;const list=cameraRef.current;async function start(){for(const c of list){if(!active)return;try{const r=await fetch('/api/previews/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cameraId:c.cameraId,cameraName:c.cameraName||c.ring||c.cameraId})});if(!r.ok&&r.status!==409){const data=await r.json().catch(()=>({}));setMessage(`Preview ${c.ring}: ${data.error||r.status}`);}}catch(e){setMessage(`Preview start failed: ${String(e)}`);}}}void start();return()=>{active=false;};},[cameraIds]);
 // Poll every eligible camera, not only the one on the public display.
 useEffect(()=>{let active=true;async function sample(){if(busy.current)return;busy.current=true;try{await Promise.all(cameraRef.current.map(async c=>{try{const r=await fetch(jpegUrl(c.cameraId),{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);const blob=await r.blob();const url=URL.createObjectURL(blob);const img=new Image();try{await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('Invalid JPEG'));img.src=url;});const pixels=centrePixels(img);const prev=last.current.get(c.cameraId);const score=prev?difference(prev,pixels):0;last.current.set(c.cameraId,pixels);if(active)setSamples(s=>({...s,[c.cameraId]:{url,score,updated:Date.now(),status:'ready'}}));else URL.revokeObjectURL(url);}catch(e){URL.revokeObjectURL(url);throw e;}}catch(e){if(active)setSamples(s=>({...s,[c.cameraId]:{...s[c.cameraId],url:s[c.cameraId]?.url||'',score:0,updated:s[c.cameraId]?.updated||0,status:'error',error:String(e)}}));}}));}finally{busy.current=false;}}
 void sample();const t=setInterval(()=>void sample(),1500);return()=>{active=false;clearInterval(t);};},[cameraIds]);
 // Revoke replaced object URLs after React commits them; avoid leaking one blob every poll.
 const oldUrls=useRef<Record<string,string>>({});useEffect(()=>{for(const [id,url] of Object.entries(oldUrls.current)){if(samples[id]?.url!==url)URL.revokeObjectURL(url);}oldUrls.current=Object.fromEntries(Object.entries(samples).map(([id,v])=>[id,v.url]).filter(([,v])=>v));},[samples]);
 useEffect(()=>()=>{for(const url of Object.values(oldUrls.current))URL.revokeObjectURL(url);},[]);
 useEffect(()=>{const t=setInterval(()=>{if(sponsorRef.current>=0||Date.now()<due.current||!cameraRef.current.length)return;const now=Date.now();const ready=cameraRef.current.filter(c=>samplesRef.current[c.cameraId]?.status==='ready'&&now-samplesRef.current[c.cameraId].updated<6000);if(!ready.length){setMessage('Waiting for camera frames. Check preview status and camera assignments.');return;}
 // Prefer a camera above threshold. If none qualifies, use the highest movement score.
 const eligible=ready.filter(c=>samplesRef.current[c.cameraId].score>=config.motionThreshold);
 const pool=eligible.length?eligible:ready;
 const ranked=[...pool].sort((a,b)=>samplesRef.current[b.cameraId].score-samplesRef.current[a.cameraId].score);
 const next=ranked.find(c=>c.cameraId!==current.current)||ranked[0];
 if(!next)return;current.current=next.cameraId;setSelected(next.cameraId);due.current=now+config.cameraSeconds*1000;changes.current++;setMessage(eligible.length?'Switched to active camera':'No camera met threshold; showing highest movement');
 if(config.sponsorEvery>0&&config.sponsorVideos.length&&changes.current%config.sponsorEvery===0){setSponsor((Math.floor(changes.current/config.sponsorEvery)-1)%config.sponsorVideos.length);}
 },500);return()=>clearInterval(t);},[config.cameraSeconds,config.motionThreshold,config.sponsorEvery,config.sponsorVideos]);
 function finishSponsor(){setSponsor(-1);due.current=Date.now()+config.cameraSeconds*1000;}
 const shown=cameras.find(c=>c.cameraId===selected)||cameras[0];const frame=shown&&samples[shown.cameraId];
 if(!cameras.length)return <div className="td-camera-empty">No eligible cameras. Assign cameras to rings and check the blacklist.</div>;
 return <section className="td-camera">{sponsor>=0?<video key={sponsor} src={config.sponsorVideos[sponsor]} autoPlay playsInline onEnded={finishSponsor} onError={finishSponsor} className="td-video"/>:<>{frame?.url?<img key={shown.cameraId} src={`/api/display-live/${encodeURIComponent(shown.cameraId)}`} alt="Live tournament camera" className="td-preview"/>:<p>Waiting for live camera feed. {message}</p>}</>}
</section>;
}
export function DisplayConfigEditor({config,onChange}:{config:DisplayConfig;onChange:(v:DisplayConfig)=>void}){function update(v:DisplayConfig){onChange(v);saveConfig(v);}return <section className="td-editor"><h3>Legacy local display settings</h3><p>Camera rotation and ring slides are configured in their dedicated editors.</p><button onClick={()=>update(DEFAULT_DISPLAY)}>Reset local legacy settings</button></section>;}
