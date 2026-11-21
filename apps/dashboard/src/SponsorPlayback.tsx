import {useEffect,useRef,useState} from 'react';
/** No native controls or end screen. A longer override loops playback to fill the slot. */
export function SponsorPlayback({src,className,durationOverride,onFinish}:{src:string;className:string;durationOverride?:number;onFinish:()=>void}){
 const video=useRef<HTMLVideoElement>(null);
 const finish=useRef(onFinish);finish.current=onFinish;
 const done=useRef(false);const [blocked,setBlocked]=useState(false);
 const complete=()=>{if(done.current)return;done.current=true;finish.current();};
 async function play(){const element=video.current;if(!element||done.current)return;try{await element.play();if(video.current===element)setBlocked(false);}catch{if(video.current===element&&!done.current)setBlocked(true);}}
 useEffect(()=>{done.current=false;void play();return()=>{done.current=true;};},[src]);
 // Advance on explicit override, or if playback never starts / stalls. The watchdog
 // resets on progress so the normal video length, even if long, remains authoritative.
 useEffect(()=>{let lastTime=-1,lastProgress=Date.now(),startedAt:number|undefined;
 const timer=setInterval(()=>{const el=video.current;if(!el||done.current)return;
 if(el.currentTime!==lastTime){lastTime=el.currentTime;lastProgress=Date.now();}
 if(!el.paused&&el.readyState>=2&&startedAt===undefined)startedAt=Date.now();
 if(durationOverride!==undefined&&startedAt!==undefined&&Date.now()-startedAt>=durationOverride*1000)complete();
 else if(Date.now()-lastProgress>20000)complete();
 },250);return()=>clearInterval(timer);},[src,durationOverride]);
 return <div className="ts-sponsor-playback"><video ref={video} src={src} autoPlay playsInline loop={durationOverride!==undefined} controls={false} disablePictureInPicture className={className} onEnded={()=>{if(durationOverride===undefined)complete();}} onError={complete} onContextMenu={e=>e.preventDefault()}/>{blocked&&<button className="ts-sound-unlock" onClick={()=>void play()}>Enable sponsor sound</button>}</div>;
}
