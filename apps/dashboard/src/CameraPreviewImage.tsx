import { memo, useEffect, useRef, useState } from 'react';
import { operatorApi } from './operator-api';

/** Keep JPEG reads local to this card; never refresh the entire dashboard for a frame. */
export const CameraPreviewImage = memo(function CameraPreviewImage({ source, alt }: {source:string;alt:string}) {
  const image = useRef<HTMLImageElement>(null);
  const [ready,setReady] = useState(false);
  useEffect(() => {
    let disposed=false, pending=false, failures=0;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let request:AbortController|undefined;
    let currentUrl:string|undefined;
    function clearTimer(){if(timer!==undefined)clearTimeout(timer);timer=undefined;}
    function clearImage(){if(image.current)image.current.removeAttribute('src');if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=undefined;}
    function schedule(delay:number){clearTimer();if(!disposed&&!document.hidden)timer=setTimeout(()=>void poll(),delay);}
    async function poll(){
      if(disposed||document.hidden||pending)return;
      pending=true;const controller=new AbortController();request=controller;
      const timeout=setTimeout(()=>controller.abort(),4000);
      try {
        const token=operatorApi.getToken();
        const headers=token?{Authorization:`Bearer ${token}`}:undefined;
        const response=await fetch(source,{cache:'no-store',signal:controller.signal,headers});
        if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg'))throw Error('Preview unavailable');
        const frame=await response.blob();
        if(disposed||controller.signal.aborted||document.hidden||!image.current)return;
        if(frame.size===0||frame.size>8*1024*1024)throw Error('Invalid preview size');
        const next=URL.createObjectURL(frame);const previous=currentUrl;currentUrl=next;image.current.src=next;
        if(previous)URL.revokeObjectURL(previous);failures=0;setReady(true);
      } catch {
        if(!disposed&&!document.hidden&&++failures>=3){clearImage();setReady(false);}
      } finally {
        clearTimeout(timeout);request=undefined;pending=false;schedule(failures?1000:250);
      }
    }
    function visibilityChanged(){clearTimer();if(document.hidden){request?.abort();return;}if(!pending)void poll();}
    setReady(false);document.addEventListener('visibilitychange',visibilityChanged);void poll();
    return()=>{disposed=true;clearTimer();request?.abort();clearImage();document.removeEventListener('visibilitychange',visibilityChanged);};
  },[source]);
  return <><img ref={image} alt={alt} className="camera-preview-video" style={{visibility:ready?'visible':'hidden'}} onError={()=>setReady(false)}/>{!ready&&<div className="camera-preview-placeholder camera-preview-reconnecting" role="status">Waiting for video…</div>}</>;
});
