import test from 'node:test';
import assert from 'node:assert/strict';
import { restartDelay, restartDecision, validateConfig } from '../scripts/windows/supervisor.mjs';
test('restart backoff increases and caps',()=>{
 assert.deepEqual([1,2,3,4].map(n=>restartDelay(n)),[2000,4000,8000,16000]);
 assert.equal(restartDelay(999),120000);
});
test('restart after unexpected clean exit and crash',()=>{
 assert.equal(restartDecision({role:'node',uptimeMs:500,exitCode:0,stopping:false,crashes:2}).restart,true);
 assert.equal(restartDecision({role:'dashboard',uptimeMs:500,exitCode:1,stopping:false,crashes:3}).delayMs,8000);
});
test('operator shutdown never restarts',()=>{
 assert.deepEqual(restartDecision({role:'node',uptimeMs:500,exitCode:0,stopping:true,crashes:1}),{restart:false,reason:'SHUTDOWN'});
});
test('long healthy run resets restart delay',()=>{
 assert.equal(restartDecision({role:'node',uptimeMs:65000,exitCode:1,stopping:false,crashes:10}).delayMs,2000);
});
test('rejects unsafe health URLs and roles',()=>{
 assert.throws(()=>validateConfig({role:'node',healthUrl:'http://example.com'}),/local/);
 assert.throws(()=>validateConfig({role:'other'}),/role/);
 assert.throws(()=>validateConfig({role:'node',maxRestarts:-1}),/maxRestarts/);
 assert.equal(validateConfig({role:'node',healthUrl:'http://127.0.0.1:3000/api/health'}).role,'node');
});
