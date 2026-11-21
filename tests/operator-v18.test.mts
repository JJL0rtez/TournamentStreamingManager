import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {startPolling} from '../apps/dashboard/src/operator-polling.ts';
import {pruneNotificationMarks,summarizeNotifications} from '../apps/dashboard/src/notification-state.ts';
import {installSponsorMedia, sponsorVideoType,MAX_SPONSOR_BYTES} from '../apps/node-service/src/sponsor-media.ts';
import {isSponsorVideoUrl} from '../apps/node-service/src/tournament-displays.ts';
import {switchableRecordingEnabled} from '../apps/node-service/src/switchable-recording.ts';
const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('acknowledgements survive incomplete initial node health, clear only on confirmed resolution',()=>{
 const marks={'local:disk':'critical'};
 assert.equal(pruneNotificationMarks(marks,[],[]),marks);
 const alerts=[{id:'local:disk',severity:'critical' as const}];
 assert.equal(summarizeNotifications(alerts,marks,{}).top,undefined);
 assert.deepEqual(pruneNotificationMarks(marks,alerts,['local']),marks);
 assert.deepEqual(pruneNotificationMarks(marks,[],['local']),{});
 assert.match(read('apps/dashboard/src/GlobalNotifications.tsx'),/node.online && node.complete === true/);
 assert.match(read('apps/dashboard/src/App.tsx'),/complete: alertSnapshotReady/);
});
test('polling never overlaps, stops cleanly after current pending task',async()=>{
 let count=0;let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const stop=startPolling(async()=>{count++;await blocked;},5);
 await new Promise(r=>setTimeout(r,30));assert.equal(count,1);stop();release();
 await new Promise(r=>setTimeout(r,30));assert.equal(count,1);
});
test('sponsor upload persists a generated file and validates the local media URL',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tournament-sponsor-'));let upload:any,serve:any;
 const app={post(_url:string,handler:any){upload=handler;},get(_url:string,handler:any){serve=handler;}};
 installSponsorMedia(app as any,dir);
 const sample=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,0,0,0,0]);
 async function invoke(bytes:Buffer,type:string,length=bytes.length){const req=Object.assign(Readable.from([bytes]),{get:(name:string)=>name==='content-type'?type:String(length)});let result:any;let code=200;const res={status(n:number){code=n;return this;},json(v:any){result=v;}};await upload(req,res);return {code,result};}
 try{
  const success=await invoke(sample,'video/mp4');assert.equal(success.code,201);assert.ok(isSponsorVideoUrl(success.result.url));
  const name=success.result.url.split('/').at(-1);assert.deepEqual(await readFile(path.join(dir,name)),sample);
  const bad=await invoke(Buffer.alloc(20),'video/mp4');assert.equal(bad.code,415);
  const tooBig=await invoke(sample,'video/mp4',MAX_SPONSOR_BYTES+1);assert.equal(tooBig.code,413);
  assert.equal((await readdir(dir)).length,1);assert.equal(sponsorVideoType(sample),'mp4');
  assert.equal(isSponsorVideoUrl('https://user:password@example.com/video.mp4'),false);
  let code=0;serve({params:{name:'../private'}},{sendStatus(n:number){code=n;}});assert.equal(code,404);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('distributed output switching is separately opted in',()=>{
 assert.equal(switchableRecordingEnabled({TOURNAMENT_DYNAMIC_RECORDING:'1',TSM_DISTRIBUTED_CAPTURE:'1'}),false);
 assert.equal(switchableRecordingEnabled({TOURNAMENT_DYNAMIC_RECORDING:'1',TSM_DISTRIBUTED_CAPTURE:'1',TSM_DISTRIBUTED_DYNAMIC_RECORDING:'1'}),true);
});
