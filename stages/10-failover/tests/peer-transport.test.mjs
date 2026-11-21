import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerTransport,normalizeEndpoints} from '../apps/node-service/src/peer-transport.ts';
const endpoints=normalizeEndpoints('http://primary.local:3001','http://lan.local:3001','http://100.64.0.1:3001');
test('prefers Tailscale, then LAN, then primary; removes duplicates',()=>{
 assert.deepEqual(endpoints.map(x=>x.kind),['tailscale','lan','primary']);
 assert.equal(normalizeEndpoints('http://a:3001','http://a:3001').length,1);
});
test('rejects credentials, paths and unsafe schemes',()=>{
 for(const u of ['ftp://example.com','http://user:pass@example.com','http://example.com/other','http://example.com/?x=1'])
  assert.throws(()=>normalizeEndpoints(u));
});
test('GET fails over and remembers working endpoint',async()=>{
 const urls=[];const transport=new PeerTransport(async url=>{
  urls.push(url);if(url.startsWith('http://100.64.'))throw Error('offline');
  return new Response('{}',{status:200});
 });
 const result=await transport.request('secondary',endpoints,'/api/health','secret');
 assert.equal(result.endpoint.kind,'lan');assert.equal(urls.length,2);
 urls.length=0;await transport.request('secondary',endpoints,'/api/health','secret');
 assert.equal(urls.length,1);assert.ok(urls[0].startsWith('http://lan.'));
});
test('GET retries transient 503 but not authentication 401',async()=>{
 let calls=0;
 const t=new PeerTransport(async()=>{calls++;return new Response('',{status:calls===1?503:200});});
 assert.equal((await t.request('x',endpoints,'/api/health','secret')).response.status,200);
 assert.equal(calls,2);
 const t2=new PeerTransport(async()=>{calls++;return new Response('',{status:401});});
 assert.equal((await t2.request('y',endpoints,'/api/health','secret')).response.status,401);
 assert.equal(calls,3);
});
test('POST never retries across transports, including timeout',async()=>{
 let calls=0;const t=new PeerTransport(async()=>{calls++;throw Error('timeout');});
 await assert.rejects(t.request('x',endpoints,'/api/captures/start','secret',{method:'POST',body:'{}'}));
 assert.equal(calls,1);
});
test('rejects malformed API routes',async()=>{
 const t=new PeerTransport();
 await assert.rejects(t.request('x',endpoints,'https://evil.test','secret'));
 await assert.rejects(t.request('x',endpoints,'/api/../secrets','secret'));
});
