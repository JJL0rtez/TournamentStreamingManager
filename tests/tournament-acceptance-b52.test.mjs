import test from 'node:test';import assert from 'node:assert/strict';import {parseArgs,summarizeAcceptance} from '../tools/tournament-acceptance.mjs';
const report=(host,cameras)=>({host,summary:{status:'pass'},cameras:cameras.map(cameraId=>({cameraId,status:'pass'}))});
test('accepts separate PC reports',()=>{const x=summarizeAcceptance([report('pc1',['a','b']),report('pc2',['c'])],{expectedCameras:3});assert.equal(x.status,'pass');assert.equal(x.testedCameras,3);});
test('missing cameras fails readiness',()=>assert.equal(summarizeAcceptance([report('pc1',['a'])],{expectedCameras:2}).status,'fail'));
test('duplicate ring IDs fail',()=>assert.equal(summarizeAcceptance([report('pc1',['a']),report('pc2',['a'])],{expectedCameras:2}).status,'fail'));
test('failed host checks propagate',()=>assert.equal(summarizeAcceptance([{host:'pc1',summary:{status:'fail'},checks:[]}],{expectedCameras:1}).status,'fail'));
test('failed camera result propagates',()=>{const r=report('pc1',['a']);r.cameras[0].status='fail';assert.equal(summarizeAcceptance([r],{expectedCameras:1}).status,'fail');});
test('rejects invalid expected count',()=>assert.throws(()=>parseArgs(['--input','a','--expected-cameras','9'])));
test('rejects empty input',()=>assert.throws(()=>parseArgs([])));
