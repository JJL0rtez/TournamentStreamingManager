import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readBoundedResponse,RemoteResponseTooLarge} from '../apps/node-service/src/remote-response-limit.ts';
const src=readFileSync(new URL('../apps/node-service/src/remote-nodes.ts',import.meta.url),'utf8');
test('bounded response reads small JSON',async()=>{
 const result=await readBoundedResponse(new Response('{"ok":true}',{headers:{'content-length':'11'}}),1024);
 assert.equal(result.toString(),'{"ok":true}');
});
test('rejects declared oversized response',async()=>{
 await assert.rejects(readBoundedResponse(new Response('hello',{headers:{'content-length':'99999'}}),10),RemoteResponseTooLarge);
});
test('rejects oversized chunked response',async()=>{
 await assert.rejects(readBoundedResponse(new Response(new Uint8Array(20)),10),RemoteResponseTooLarge);
});
test('accepts exact boundary',async()=>{
 assert.equal((await readBoundedResponse(new Response('1234567890'),10)).length,10);
});
test('rejects malformed content length',async()=>{
 await assert.rejects(readBoundedResponse(new Response('hello',{headers:{'content-length':'NaN'}}),10),RemoteResponseTooLarge);
});
test('rejects invalid max bytes',async()=>{
 await assert.rejects(readBoundedResponse(new Response('hello'),0),RangeError);
});
test('new distributed actions are explicit allowlist entries',()=>{
 assert.match(src,/distributed-\(start-all\|stop-all\)/);
 assert.match(src,/distributed-restart/);
 assert.match(src,/recover\|recording\|frame/);
});
test('new remote distributed mutations require opt-in',()=>{
 assert.match(src,/TSM_REMOTE_DISTRIBUTED_CONTROL/);
 assert.match(src,/res\.status\(403\)/);
});
test('upstream response read uses streaming bounded helper',()=>{
 assert.match(src,/readBoundedResponse\(upstream, maxBytes\)/);
 assert.doesNotMatch(src,/await upstream\.arrayBuffer\(\)/);
});
test('write requests are not retried across transports',()=>{
 const transport=readFileSync(new URL('../apps/node-service/src/peer-transport.ts',import.meta.url),'utf8');
 assert.match(transport,/method==="GET"\?ordered:ordered\.slice\(0,1\)/);
});
