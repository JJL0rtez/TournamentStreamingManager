/** Video metadata/end events drive automatic sponsors; ordinary slides use a timer. */
export function slideTiming(slide:{kind:string;videoUrl?:string;duration:number;durationOverride?:boolean}):{mode:"media"}|{mode:"timer";seconds:number}{
 if(slide.kind==="sponsor"&&slide.videoUrl&&!slide.durationOverride)return {mode:"media"};
 return {mode:"timer",seconds:Math.max(3,Math.min(3600,Number.isFinite(slide.duration)?slide.duration:20))};
}
/** Older uploads have no original filename; never expose the generated storage ID. */
export function sponsorFileLabel(url:string,name:string|undefined,index:number):string {
 if(name)return name.split(/[\\/]/).pop()||`Sponsor video ${index+1}`;
 if(url.startsWith('/api/tournament-displays/media/'))return `Sponsor video ${index+1} (original filename unavailable)`;
 try{return decodeURIComponent(new URL(url).pathname.split('/').pop()||'')||`Sponsor video ${index+1}`;}catch{return `Sponsor video ${index+1}`;}
}
