import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBroadcastMap, queryPlatformHealth,createPlatformHealthReader} from '../apps/node-service/src/youtube-platform-health.ts';
const mapping = JSON.stringify([{cameraId:'ring1',broadcastId:'broadcast1'},{cameraId:'ring2',broadcastId:'broadcast2'}]);
const fakeFetch = async (url:URL|RequestInfo) => {
 const path = String(url);
 const payload = path.includes('liveBroadcasts') ? {items:[
  {id:'broadcast1',status:{lifeCycleStatus:'live'},contentDetails:{boundStreamId:'stream1'}},
  {id:'broadcast2',status:{lifeCycleStatus:'testing'},contentDetails:{boundStreamId:'stream2'}}
 ]}:{items:[
  {id:'stream1',status:{streamStatus:'active',healthStatus:{status:'good'}}},
  {id:'stream2',status:{streamStatus:'inactive',healthStatus:{status:'noData'}}}
 ]};
 return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(payload)} as Response;
};
test('valid mapping rejects duplicates and malformed camera IDs',()=>{
 assert.equal(parseBroadcastMap(mapping).length,2);
 assert.throws(()=>parseBroadcastMap('[{"cameraId":"../x","broadcastId":"b"}]'));
 assert.throws(()=>parseBroadcastMap('[{"cameraId":"x","broadcastId":"b"},{"cameraId":"x","broadcastId":"c"}]'));
 assert.throws(()=>parseBroadcastMap('not json'));
});
test('reads live broadcast and ingest status separately',async()=>{
 const report=await queryPlatformHealth(parseBroadcastMap(mapping),'a'.repeat(32),fakeFetch as typeof fetch);
 assert.equal(report.status,'unknown');assert.equal(report.cameras[0].broadcast,'live');assert.equal(report.cameras[0].ingest,'active');
 assert.equal(report.cameras[1].broadcast,'testing');assert.match(report.cameras[1].issues.join(' '),/Ingest stream: inactive/);
});
test('authorization failure is unknown without exposing tokens',async()=>{
 const token='myverysecretaccesstoken';
 const result=await queryPlatformHealth(parseBroadcastMap(mapping),token,async()=>({ok:false,status:401,headers:new Headers()} as Response));
 assert.equal(result.status,'unknown');assert.equal(result.stale,true);assert.ok(!JSON.stringify(result).includes(token));
});
test('cached single-flight requests share result and enforce interval',async()=>{
 let calls=0;let now=1000;
 const request=async(url:any)=>{calls++;return fakeFetch(url);};
 const read=createPlatformHealthReader(()=>({mapping,token:'a'.repeat(32)}),request as typeof fetch,()=>now);
 await Promise.all([read(),read(),read()]);assert.equal(calls,2);
 await read();assert.equal(calls,2);
 now+=61000;await read();assert.equal(calls,4);
});
test('missing config and token never contact API',async()=>{
 let calls=0;const request=async()=>{calls++;throw new Error('should not call')};
 assert.equal((await queryPlatformHealth([], 'a'.repeat(32),request as typeof fetch)).enabled,false);
 assert.equal((await queryPlatformHealth(parseBroadcastMap(mapping),'',request as typeof fetch)).status,'unknown');assert.equal(calls,0);
});
test('remote proxy forwards health only as GET and dashboard is mounted',async()=>{
 const fs=await import('node:fs');
 const remote=fs.readFileSync('apps/node-service/src/remote-nodes.ts','utf8');
 const api=fs.readFileSync('apps/node-service/src/api.ts','utf8');
 const dashboard=fs.readFileSync('apps/dashboard/src/App.tsx','utf8');
 assert.match(remote,/operations\\\/youtube-platform-health/);
 assert.match(api,/app\.get\("\/api\/operations\/youtube-platform-health"/);
 assert.match(dashboard,/<YouTubePlatformHealthPanel request=\{request\}/);
});
test('refresh-token provider reuses OAuth token and never exposes credentials',async()=>{
  const {createYouTubeTokenProvider}=await import('../apps/node-service/src/youtube-platform-health.ts');
  const secret='secret-value';let calls=0;let clock=0;
  const fetcher=async(_url:unknown,init:any)=>{
    calls++;assert.equal(init.method,'POST');assert.ok(String(init.body).includes('grant_type=refresh_token'));
    return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({access_token:'temporary-access-token-12345678',expires_in:3600})} as Response;
  };
  const provider=createYouTubeTokenProvider(()=>({clientId:'client',clientSecret:secret,refreshToken:'refresh'}),fetcher as typeof fetch,()=>clock);
  const tokens=await Promise.all([provider(),provider()]);assert.equal(tokens[0],tokens[1]);assert.equal(calls,1);
  await provider();assert.equal(calls,1);clock+=3550000;await provider();assert.equal(calls,2);
});
test('incomplete OAuth refresh config fails closed',async()=>{
 const {createYouTubeTokenProvider}=await import('../apps/node-service/src/youtube-platform-health.ts');
 const provider=createYouTubeTokenProvider(()=>({accessToken:'static-token',clientId:'only-a-client'}));
 assert.equal(await provider(),'');
});
