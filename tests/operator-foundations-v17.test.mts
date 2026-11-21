import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorRequest} from '../apps/dashboard/src/operator-api.ts';
import {chooseMicrophone} from '../apps/dashboard/src/microphone-identity.ts';
import {operatorError} from '../apps/dashboard/src/operator-errors.ts';
test('concurrent identical GET requests coalesce but mutations never coalesce', async()=>{
 let calls=0; const client=createOperatorRequest(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json({ok:true});});
 await Promise.all([client.request('/api/captures'),client.request('/api/captures')]); assert.equal(calls,1);
 await Promise.all([client.request('/api/start',{method:'POST'}),client.request('/api/start',{method:'POST'})]); assert.equal(calls,3);
 await client.request('/api/captures');assert.equal(calls,4);
});
test('authentication changes and caller-owned abort signals isolate reads',async()=>{
 const observed:string[]=[];const client=createOperatorRequest(async(_url,opts)=>{observed.push(new Headers(opts?.headers).get('Authorization')||'');return Response.json({});});
 client.setToken('one'); const a=client.request('/api/captures');client.setToken('two'); const b=client.request('/api/captures'); await Promise.all([a,b]);
 assert.deepEqual(observed,['Bearer one','Bearer two']);
 await Promise.all([client.request('/api/captures',{signal:new AbortController().signal}),client.request('/api/captures',{signal:new AbortController().signal})]);assert.equal(observed.length,4);
});
test('failed GETs are not cached',async()=>{
 let calls=0;const client=createOperatorRequest(async()=>{calls++;return Response.json({error:'offline'},{status:503});});
 await assert.rejects(client.request('/api/captures'),/offline/);await assert.rejects(client.request('/api/captures'),/offline/);assert.equal(calls,2);
});
test('physical microphone IDs distinguish identical names and preserve disconnected assignments',()=>{
 const camera={id:'cam',name:'EMEET SmartCam S600'};
 const mics=[{id:'one',name:'Microphone (EMEET SmartCam S600)'},{id:'two',name:'Microphone (EMEET SmartCam S600)'}];
 assert.equal(chooseMicrophone(camera,mics,'two')?.id,'two');
 assert.equal(chooseMicrophone(camera,mics,'missing'),null);
 assert.equal(chooseMicrophone(camera,mics,undefined,undefined,mics[0].name),null);
 assert.equal(chooseMicrophone(camera,[mics[0]])?.id,'one');
});
test('friendly capture errors preserve safe details and redact stream credentials',()=>{
 const result=operatorError('Capture input is already active or starting (matching cameraName) rtmps://example/key Bearer secret');
 assert.match(result.summary,/already being used/);assert.doesNotMatch(result.detail,/example\/key|Bearer secret/);
});
