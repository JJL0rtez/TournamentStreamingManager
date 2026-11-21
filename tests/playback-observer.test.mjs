import test from 'node:test';
import assert from 'node:assert/strict';
import {validateObserverConfig, classifyPlaybackProbe, publicPlaybackReport, probePlayback} from '../packages/playback-observer/observer.mjs';
const config = { cameras: [{cameraId:'ring1',playbackUrl:'https://cdn.example.org/video.m3u8'}] };
test('validates bounded public playback configuration', () => { assert.equal(validateObserverConfig(config).probeSeconds,12); assert.throws(()=>validateObserverConfig({...config,cameras:[...config.cameras,...config.cameras]}),/Duplicate/); });
test('rejects secrets, local URLs and oversized test windows', () => {
  for(const url of ['http://example.org/x','https://user:pw@example.org/x','https://localhost/x','https://192.168.1.4/x','https://example.org/x?token=SECRET']) assert.throws(()=>validateObserverConfig({cameras:[{cameraId:'ring1',playbackUrl:url}]}));
  assert.throws(()=>validateObserverConfig({...config,probeSeconds:120}));
});
test('classifies frozen/black/silent media and never claims YouTube verification', () => {
 const p=classifyPlaybackProbe({code:0,stderr:'frame=  48\nfreeze_start:3\nblack_start:4\nsilence_start:5'},'ring1');
 assert.equal(p.status,'warning'); assert.equal(p.framesDecoded,48); assert.equal(p.issues.length,3);
 const pub=publicPlaybackReport([p]); assert.equal(pub.youtubePlatformVerified,false); assert.equal(pub.cameras[0].youtubePlatformVerified,undefined);
});
test('decoder failure is not interpreted as healthy playback', () => {
 const p=classifyPlaybackProbe({code:-1,stderr:''},'ring1'); assert.equal(p.status,'warning'); assert.match(p.issues.join(' '),/No decoded/);
});
test('spawns ffmpeg with bounded input and no output media file', async () => {
  const {EventEmitter}=await import('node:events');
  let args=[];
  const sample=await probePlayback(config.cameras[0],5,{spawn:(_exe, argv)=>{
    args=argv; const process=new EventEmitter(); const stderr=new EventEmitter(); process.stderr=stderr; process.kill=()=>{};
    queueMicrotask(()=>{ stderr.emit('data','frame= 150'); process.emit('close',0); }); return process;
  }});
  assert.equal(sample.status,'healthy'); assert.equal(args.at(-1),'-'); assert.equal(args.includes('-vf'),true); assert.equal(args.includes('-af'),true);
});
