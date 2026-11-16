import {useEffect,useRef,useState} from "react";
import "./Presentation.css";

type Assignment={ring:string;cameraName:string;cameraId:string};
type Session={eventName:string;assignments:Assignment[]};
type Slide={id:string;title:string;body:string;duration:number;kind:"announcement"|"sponsor"|"schedule";imageUrl?:string;theme?:"default"|"blue"|"gold"|"dark"};
type Layout="classic"|"split"|"minimal";
const SETTINGS_KEY="tournament-presentation-settings-v1";
type Board={slides:Slide[];updatedAt:number};
const KEY="tournament-billboard-v1";
const defaultBoard:Board={updatedAt:0,slides:[
{id:"welcome",title:"Welcome",body:"Tournament information will appear here.",duration:12,kind:"announcement"},
{id:"schedule",title:"Tournament Schedule",body:"See the tournament desk for updated schedules.",duration:12,kind:"schedule"}]};
function readBoard():Board{try{const value=JSON.parse(localStorage.getItem(KEY)||"null");if(value&&Array.isArray(value.slides))return value;}catch{}return defaultBoard;}
function safeText(value:string,max=400){return value.slice(0,max);}
function imageAllowed(url:string){if(!url)return true;if(/^\/api\/billboard\/assets\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(url))return true;try{const parsed=new URL(url);return parsed.protocol==="https:"&&url.length<=1000&&!parsed.username&&!parsed.password;}catch{return false;}}
const templates:Slide[]=[
 {id:"",title:"Welcome to the Tournament",body:"Good luck to all competitors!",duration:12,kind:"announcement",theme:"blue"},
 {id:"",title:"Thank You to Our Sponsors",body:"We appreciate your support.",duration:15,kind:"sponsor",theme:"gold"},
 {id:"",title:"Schedule Update",body:"Please check with the tournament desk for the latest ring assignments.",duration:12,kind:"schedule",theme:"dark"},
 {id:"",title:"Awards Ceremony",body:"Awards will be announced at the conclusion of the division.",duration:12,kind:"announcement",theme:"gold"}
];
export default function Presentation(){
 const [session,setSession]=useState<Session|null>(null);
 const [status,setStatus]=useState("Connecting to tournament service...");
 const [board,setBoard]=useState<Board>(readBoard);
 const [index,setIndex]=useState(0);
 const [mode,setMode]=useState<"rings"|"billboard">(()=>new URLSearchParams(location.search).get("mode")==="billboard"?"billboard":"rings");
 const [editing,setEditing]=useState(false);
 const [fullscreen,setFullscreen]=useState(false);
 const [syncStatus,setSyncStatus]=useState("Connecting...");
 const [revision,setRevision]=useState(0);
 const [now,setNow]=useState(Date.now());
 const [paused,setPaused]=useState(false);
 const [showClock,setShowClock]=useState(true);
 const [layout,setLayout]=useState<Layout>(()=>{try{const value=localStorage.getItem(SETTINGS_KEY);return value==="split"||value==="minimal"?value:"classic";}catch{return "classic";}});
 const [message,setMessage]=useState("");
 const [bundlePreview,setBundlePreview]=useState<{eventName:string;assignments:number;slides:number;filename:string}|null>(null);
 const bundleRef=useRef<{session:unknown;board:Board;layout:Layout;showClock:boolean}|null>(null);
 const [assets,setAssets]=useState<{name:string;url:string;bytes:number}[]>([]);
 const [uploading,setUploading]=useState(false);
 const [presets,setPresets]=useState<{id:string;name:string;createdAt:string}[]>([]);
 const [presetName,setPresetName]=useState("");
 const [selectedPreset,setSelectedPreset]=useState("");
 async function refreshPresets(){try{const r=await fetch("/api/billboard/presets",{cache:"no-store"});if(!r.ok)throw Error(`HTTP ${r.status}`);setPresets((await r.json()).presets);}catch(e){setMessage(`Presets unavailable: ${String(e)}`);}}
 async function savePreset(){try{const name=presetName.trim();if(!name||name.length>80)throw Error("Enter a preset name (up to 80 characters)");await saveQueue.current;const r=await fetch("/api/billboard/presets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,board,layout,showClock})});if(!r.ok)throw Error((await r.json()).error||`HTTP ${r.status}`);setPresetName("");await refreshPresets();setMessage(`Saved preset: ${name}`);}catch(e){setMessage(`Save preset failed: ${String(e)}`);}}
 async function loadPreset(){try{if(!selectedPreset)throw Error("Select a preset");const r=await fetch(`/api/billboard/presets/${encodeURIComponent(selectedPreset)}`,{cache:"no-store"});if(!r.ok)throw Error(`HTTP ${r.status}`);const {preset}=await r.json();if(!confirm(`Replace the active billboard with preset "${preset.name}"?`))return;await saveQueue.current;chooseLayout(preset.layout);setShowClock(preset.showClock);update(preset.board.slides);setMessage(`Loaded preset: ${preset.name}`);}catch(e){setMessage(`Load preset failed: ${String(e)}`);}}
 async function deletePreset(){try{if(!selectedPreset)throw Error("Select a preset");if(!confirm("Permanently delete the selected preset?"))return;const r=await fetch(`/api/billboard/presets/${encodeURIComponent(selectedPreset)}`,{method:"DELETE"});if(!r.ok)throw Error(`HTTP ${r.status}`);setSelectedPreset("");await refreshPresets();setMessage("Preset deleted");}catch(e){setMessage(`Delete preset failed: ${String(e)}`);}}
 async function refreshAssets(){try{const r=await fetch("/api/billboard/assets",{cache:"no-store"});if(!r.ok)throw Error(`HTTP ${r.status}`);setAssets((await r.json()).assets);}catch(e){setMessage(`Asset list unavailable: ${String(e)}`);}}
 async function uploadImage(file:File,slideId:string){if(file.size>5*1024*1024){setMessage("Image exceeds 5 MB");return;}if(!["image/png","image/jpeg","image/webp"].includes(file.type)){setMessage("Choose PNG, JPEG or WebP");return;}setUploading(true);try{const r=await fetch("/api/billboard/assets",{method:"POST",headers:{"Content-Type":file.type},body:file});if(!r.ok)throw Error((await r.json()).error||`HTTP ${r.status}`);const data=await r.json();update(board.slides.map(slide=>slide.id===slideId?{...slide,imageUrl:data.url}:slide));await refreshAssets();setMessage("Image uploaded and assigned");}catch(e){setMessage(`Upload failed: ${String(e)}`);}finally{setUploading(false);}}
 async function deleteAsset(name:string){if(!confirm("Delete this unused image?"))return;try{const r=await fetch(`/api/billboard/assets/${encodeURIComponent(name)}`,{method:"DELETE"});if(!r.ok)throw Error((await r.json()).error||`HTTP ${r.status}`);await refreshAssets();}catch(e){setMessage(`Delete failed: ${String(e)}`);}}
 const importRef=useRef<HTMLInputElement>(null);
 const currentRevision=useRef(0);
 const pendingSave=useRef(false);
 const saveQueue=useRef<Promise<void>>(Promise.resolve());
 useEffect(()=>{let alive=true;const load=async()=>{try{const response=await fetch("/api/session",{cache:"no-store"});if(!response.ok)throw Error(`HTTP ${response.status}`);const data=await response.json();if(alive){setSession(data.session??null);setStatus("Connected");}}catch(e){if(alive)setStatus(`Offline: ${String(e)}`);}};void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer);};},[]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let alive=true;const load=async()=>{try{const r=await fetch("/api/billboard",{cache:"no-store"});if(!r.ok)throw Error(`HTTP ${r.status}`);const v=await r.json();if(alive){if(!pendingSave.current && v.revision>=currentRevision.current){setBoard(v.board);setRevision(v.revision);currentRevision.current=v.revision;setSyncStatus("Shared with tournament server");}}}catch(e){if(alive)setSyncStatus(`Local-only: ${String(e)}`);}};void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer);};},[]);
 useEffect(()=>{void refreshAssets();void refreshPresets();},[]);
 useEffect(()=>{const onStorage=(e:StorageEvent)=>{if(e.key===KEY)setBoard(readBoard());};window.addEventListener("storage",onStorage);return()=>window.removeEventListener("storage",onStorage);},[]);
 useEffect(()=>{if(mode!=="billboard"||editing||paused||board.slides.length<2)return;const current=board.slides[index%board.slides.length];const timer=setTimeout(()=>setIndex(i=>(i+1)%board.slides.length),Math.max(3,Math.min(120,current.duration||10))*1000);return()=>clearTimeout(timer);},[board,index,mode,editing,paused]);
 useEffect(()=>{const onChange=()=>setFullscreen(!!document.fullscreenElement);document.addEventListener("fullscreenchange",onChange);return()=>document.removeEventListener("fullscreenchange",onChange);},[]);
 function update(next:Slide[]){
  const b={slides:next,updatedAt:Date.now()};
  localStorage.setItem(KEY,JSON.stringify(b));setBoard(b);setIndex(i=>Math.min(i,Math.max(0,next.length-1)));
  pendingSave.current=true;
  saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{
   try{const r=await fetch("/api/billboard",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({board:b,expectedRevision:currentRevision.current})});
    if(r.status===409){const fresh=await r.json();setBoard(fresh.board);setRevision(fresh.revision);currentRevision.current=fresh.revision;setSyncStatus("Another operator updated slides. Reloaded latest.");return;}
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const saved=await r.json();setRevision(saved.revision);currentRevision.current=saved.revision;setSyncStatus("Saved to tournament server");
   }catch(e){setSyncStatus(`Local-only: ${String(e)}`);}
  });
  void saveQueue.current.finally(()=>{pendingSave.current=false;});
 }
 function chooseLayout(next:Layout){setLayout(next);try{localStorage.setItem(SETTINGS_KEY,next);}catch{}}
 function exportSlides(){const blob=new Blob([JSON.stringify({format:"tournament-billboard-v1",slides:board.slides},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="tournament-billboard.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function importSlides(file:File){try{if(file.size>100_000)throw Error("File exceeds 100 KB");const data=JSON.parse(await file.text());if(data.format!=="tournament-billboard-v1"||!Array.isArray(data.slides)||data.slides.length>100)throw Error("Unsupported slide file");const slides:Slide[]=data.slides.map((x:unknown,i:number)=>{if(!x||typeof x!=="object")throw Error(`Invalid slide ${i+1}`);const v=x as Record<string,unknown>;if(typeof v.id!=="string"||!v.id||v.id.length>100||typeof v.title!=="string"||v.title.length>100||typeof v.body!=="string"||v.body.length>400||!(["announcement","sponsor","schedule"] as unknown[]).includes(v.kind)||!Number.isInteger(v.duration)||Number(v.duration)<3||Number(v.duration)>120)throw Error(`Invalid slide ${i+1}`);if(v.imageUrl!==undefined&&(typeof v.imageUrl!=="string"||!imageAllowed(v.imageUrl)))throw Error(`Invalid image URL ${i+1}`);if(v.theme!==undefined&&!["default","blue","gold","dark"].includes(String(v.theme)))throw Error(`Invalid theme ${i+1}`);return {id:v.id,title:v.title,body:v.body,kind:v.kind as Slide["kind"],duration:v.duration as number,imageUrl:v.imageUrl as string|undefined,theme:v.theme as Slide["theme"]};});if(new Set(slides.map(x=>x.id)).size!==slides.length)throw Error("Duplicate slide IDs");if(!confirm(`Replace current billboard with ${slides.length} imported slides?`))return;await update(slides);setMessage(`Imported ${slides.length} slides`);}catch(e){setMessage(`Import failed: ${String(e)}`);}}
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{const target=e.target as HTMLElement|null;if(target?.closest("input,textarea,select,[contenteditable=true]"))return;if(e.key==="ArrowRight"&&mode==="billboard"){e.preventDefault();setIndex(i=>(i+1)%Math.max(1,board.slides.length));}else if(e.key==="ArrowLeft"&&mode==="billboard"){e.preventDefault();setIndex(i=>(i+board.slides.length-1)%Math.max(1,board.slides.length));}else if(e.code==="Space"&&mode==="billboard"){e.preventDefault();setPaused(p=>!p);}else if(e.key.toLowerCase()==="f"&&!e.ctrlKey&&!e.metaKey){e.preventDefault();void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[mode,board.slides.length]);
 const slides=board.slides;const current=slides[index%slides.length];
 async function exportTournamentBundle(){
  try{
   await saveQueue.current;
   const sr=await fetch("/api/session",{cache:"no-store"});if(!sr.ok)throw Error(`Session HTTP ${sr.status}`);
   const sessionData=await sr.json();if(!sessionData.session)throw Error("Create a tournament session first");
   const br=await fetch("/api/billboard",{cache:"no-store"});if(!br.ok)throw Error(`Billboard HTTP ${br.status}`);
   const boardData=await br.json();
   const bundle={format:"tournament-display-bundle",version:1,exportedAt:new Date().toISOString(),session:sessionData.session,board:boardData.board,layout,showClock};
   const blob=new Blob([JSON.stringify(bundle,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download=`tournament-display-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage("Tournament display bundle exported. No stream keys included.");
  }catch(e){setMessage(`Export failed: ${String(e)}`);}
 }
 async function previewTournamentBundle(file:File){
  bundleRef.current=null;setBundlePreview(null);
  try{
   if(file.size>1024*1024)throw Error("Bundle exceeds 1 MB");
   const raw=JSON.parse(await file.text());
   if(raw?.format!=="tournament-display-bundle"||raw.version!==1||!raw.session||typeof raw.session.eventName!=="string"||!Array.isArray(raw.session.assignments)||raw.session.assignments.length>8||!raw.board||!Array.isArray(raw.board.slides)||raw.board.slides.length>100||!["classic","split","minimal"].includes(raw.layout)||typeof raw.showClock!=="boolean")throw Error("Invalid tournament display bundle");
   if(raw.board.slides.some((x:Slide)=>!x||typeof x.title!=="string"||typeof x.body!=="string"||typeof x.duration!=="number"))throw Error("Invalid slide data");
   bundleRef.current={session:raw.session,board:raw.board,layout:raw.layout,showClock:raw.showClock};
   setBundlePreview({eventName:raw.session.eventName,assignments:raw.session.assignments.length,slides:raw.board.slides.length,filename:file.name});
  }catch(e){setMessage(`Import failed: ${String(e)}`);}
 }
 async function applyTournamentBundle(){
  const bundle=bundleRef.current;if(!bundle)return;
  if(!confirm(`Apply tournament bundle for ${bundlePreview?.eventName}? All captures and YouTube relays must be stopped. This replaces the active session and shared billboard.`))return;
  try{
   await saveQueue.current;
   const sessionResponse=await fetch("/api/session",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(bundle.session)});
   if(!sessionResponse.ok)throw Error(`Session not applied: ${(await sessionResponse.text()).slice(0,300)}`);
   const b=await fetch("/api/billboard",{cache:"no-store"});if(!b.ok)throw Error(`Billboard read failed: HTTP ${b.status}`);
   const current=await b.json();
   const r=await fetch("/api/billboard",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({board:bundle.board,expectedRevision:current.revision})});
   if(!r.ok)throw Error(`Session applied, but billboard failed (HTTP ${r.status}). Retry billboard or restore previous configuration.`);
   const saved=await r.json();setBoard(saved.board);setRevision(saved.revision);chooseLayout(bundle.layout);setShowClock(bundle.showClock);setSession((await sessionResponse.json()).session);setMessage("Tournament bundle applied. Check camera and microphone assignments before starting streams.");bundleRef.current=null;setBundlePreview(null);
  }catch(e){setMessage(`Apply failed: ${String(e)}`);}
 }
 return <div className="presentation-root">
  <nav className="presentation-toolbar" aria-label="Presentation controls">
   <a href="/">Dashboard</a>
   <button onClick={()=>{setMode("rings");history.replaceState(null,"","/presentation?mode=rings");}}>Ring display</button>
   <button onClick={()=>{setMode("billboard");history.replaceState(null,"","/presentation?mode=billboard");}}>Billboard</button>
   <button onClick={()=>setEditing(v=>!v)} aria-pressed={editing}>{editing?"Close editor":"Edit billboard"}</button>
   <button onClick={()=>void(fullscreen?document.exitFullscreen():document.documentElement.requestFullscreen())}>{fullscreen?"Exit fullscreen":"Fullscreen"}</button>
   <label>Layout <select aria-label="Presentation layout" value={layout} onChange={e=>chooseLayout(e.target.value as Layout)}><option value="classic">Classic</option><option value="split">Split</option><option value="minimal">Minimal</option></select></label>
   <label><input type="checkbox" checked={showClock} onChange={e=>setShowClock(e.target.checked)}/> Clock</label>
   <span className="presentation-connection">{status} | {syncStatus}</span>
  </nav>
  <div className={`presentation-content presentation-layout-${layout}`}>
   <header><div className="presentation-event">{session?.eventName||"Tournament"}</div>{showClock&&<time>{new Date(now).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time>}</header>
   {mode==="rings"?<section className="presentation-rings" aria-label="Ring assignments">
    {(session?.assignments||[]).length?session!.assignments.map((ring,i)=><article key={`${ring.cameraId}-${i}`}><h2>{ring.ring||`Ring ${i+1}`}</h2><p>{ring.cameraName||"Camera not assigned"}</p></article>):<p className="presentation-empty">No ring assignments in the active tournament session.</p>}
   </section>:<section className={`presentation-slide ${current?.kind||"announcement"} presentation-theme-${current?.theme||"default"}`} aria-live="polite">
    {current?<><div className="presentation-slide-kind">{current.kind}</div><h1>{current.title}</h1>{current.imageUrl&&imageAllowed(current.imageUrl)&&<img className="presentation-sponsor-image" src={current.imageUrl} alt={current.title} referrerPolicy="no-referrer"/>}<p>{current.body}</p><div className="presentation-counter">{index+1} / {slides.length}</div></>:<h1>No slides configured</h1>}
   </section>}
  </div>
  {mode==="billboard"&&<div className="presentation-slide-controls"><button onClick={()=>setIndex(i=>(i+slides.length-1)%Math.max(1,slides.length))}>Previous</button><button onClick={()=>setIndex(i=>(i+1)%Math.max(1,slides.length))}>Next</button><button onClick={()=>setPaused(p=>!p)} aria-pressed={paused}>{paused?"Resume rotation":"Pause rotation"}</button></div>}
  {editing&&<aside className="presentation-editor" aria-label="Billboard editor">
   <h2>Billboard slides</h2>
   <section className="presentation-presets"><h3>Complete tournament display bundle</h3>
    <p>Export or import ring and camera assignments together with billboard slides, layout and clock settings. Stream keys are not included. Applying a bundle requires stopped captures and relays.</p>
    <button onClick={()=>void exportTournamentBundle()}>Export tournament bundle</button>
    <label>Import tournament bundle (JSON, up to 1 MB)<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void previewTournamentBundle(file);e.currentTarget.value="";}}/></label>
    {bundlePreview&&<div className="presentation-bundle-preview"><strong>Ready to import: {bundlePreview.filename}</strong><p>Event: {bundlePreview.eventName} | Rings: {bundlePreview.assignments} | Slides: {bundlePreview.slides}</p><button onClick={()=>void applyTournamentBundle()}>Apply tournament bundle</button><button onClick={()=>{bundleRef.current=null;setBundlePreview(null);}}>Cancel</button></div>}
   </section>
   <section className="presentation-presets"><h3>Saved tournament display presets</h3>
    <label>New preset name <input maxLength={80} value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="Example: Spring Championship"/></label>
    <button onClick={()=>void savePreset()}>Save current display</button>
    <label>Saved preset <select value={selectedPreset} onChange={e=>setSelectedPreset(e.target.value)}><option value="">Choose preset</option>{presets.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <button disabled={!selectedPreset} onClick={()=>void loadPreset()}>Load preset</button>
    <button disabled={!selectedPreset} onClick={()=>void deletePreset()}>Delete preset</button>
    <button onClick={()=>void refreshPresets()}>Refresh presets</button>
    <p>Presets save slides, images, layout and clock visibility. Loading a preset replaces the shared billboard for all connected displays.</p>
   </section>
   <div className="presentation-import-export"><button onClick={exportSlides}>Export slides</button><button onClick={()=>importRef.current?.click()}>Import slides</button><input ref={importRef} type="file" accept="application/json,.json" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(file)void importSlides(file);e.currentTarget.value="";}}/></div>
   {message&&<p role="status">{message}</p>}<p>Slides are shared through the tournament server when connected. Images can be uploaded to the tournament server or referenced by HTTPS URL.</p>
   {slides.map((slide,i)=><div className="presentation-edit-slide" key={slide.id}>
    <label>Title<input maxLength={100} value={slide.title} onChange={e=>update(slides.map((s,j)=>j===i?{...s,title:safeText(e.target.value,100)}:s))}/></label>
    <label>Message<textarea maxLength={400} value={slide.body} onChange={e=>update(slides.map((s,j)=>j===i?{...s,body:safeText(e.target.value)}:s))}/></label>
    <label>Type<select value={slide.kind} onChange={e=>update(slides.map((s,j)=>j===i?{...s,kind:e.target.value as Slide["kind"]}:s))}><option value="announcement">Announcement</option><option value="sponsor">Sponsor</option><option value="schedule">Schedule</option></select></label>
    <label>Theme<select value={slide.theme||"default"} onChange={e=>void update(slides.map((x,j)=>j===i?{...x,theme:e.target.value as Slide["theme"]}:x))}><option value="default">Default</option><option value="blue">Blue</option><option value="gold">Gold</option><option value="dark">Dark</option></select></label>
    <label>Image URL (HTTPS only)<input type="url" maxLength={1000} placeholder="https://example.com/sponsor.png" value={slide.imageUrl||""} onChange={e=>{const value=e.target.value;if(imageAllowed(value))void update(slides.map((x,j)=>j===i?{...x,imageUrl:value}:x));else setMessage("Image URL must use HTTPS and contain no credentials");}}/></label>
    <label>Upload image (PNG, JPEG, WebP; max 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e=>{const f=e.target.files?.[0];if(f)void uploadImage(f,slide.id);e.currentTarget.value="";}}/></label>
    <label>Choose uploaded image<select value={slide.imageUrl?.startsWith("/api/billboard/assets/")?slide.imageUrl:""} onChange={e=>void update(slides.map((x,j)=>j===i?{...x,imageUrl:e.target.value}:x))}><option value="">No uploaded image</option>{assets.map(a=><option key={a.name} value={a.url}>{a.name}</option>)}</select></label>
    <label>Seconds<input type="number" min={3} max={120} value={slide.duration} onChange={e=>update(slides.map((s,j)=>j===i?{...s,duration:Math.max(3,Math.min(120,Number(e.target.value)||10))}:s))}/></label>
    <div className="presentation-edit-actions"><button disabled={i===0} onClick={()=>{const a=[...slides];[a[i-1],a[i]]=[a[i],a[i-1]];void update(a);}}>Move up</button><button disabled={i===slides.length-1} onClick={()=>{const a=[...slides];[a[i],a[i+1]]=[a[i+1],a[i]];void update(a);}}>Move down</button><button onClick={()=>void update(slides.filter((_,j)=>j!==i))}>Remove</button></div>
   </div>)}
   <section className="presentation-asset-library"><h3>Uploaded images</h3><button onClick={()=>void refreshAssets()}>Refresh images</button>{assets.map(a=><div key={a.name}><img src={a.url} alt="Uploaded billboard asset" loading="lazy"/><span>{(a.bytes/1024).toFixed(0)} KB</span><button onClick={()=>void deleteAsset(a.name)}>Delete unused</button></div>)}</section>
   <button onClick={()=>void update([...slides,{id:crypto.randomUUID(),title:"New slide",body:"",duration:10,kind:"announcement",theme:"default"}])}>Add slide</button>
   <label>Quick template <select aria-label="Slide template" id="slide-template"><option value="0">Welcome</option><option value="1">Sponsor thank-you</option><option value="2">Schedule update</option><option value="3">Awards ceremony</option></select></label>
   <button onClick={()=>{const element=document.getElementById("slide-template") as HTMLSelectElement|null;const t=templates[Number(element?.value||0)];void update([...slides,{...t,id:crypto.randomUUID()}]);}}>Add template slide</button>
   <button onClick={()=>{if(confirm("Reset all billboard slides?"))update(defaultBoard.slides);}}>Reset slides</button>
  </aside>}
 </div>;
}
