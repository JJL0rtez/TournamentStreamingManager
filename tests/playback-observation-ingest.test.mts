import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPlaybackObservation, getPlaybackObservation } from '../apps/node-service/src/playback-observation.ts';
const now=Date.now();
const base={schemaVersion:1,source:'independent-ffmpeg-playback',youtubePlatformVerified:false,checkedAt:new Date(now).toISOString(),cameras:[{cameraId:'ring1',checkedAt:new Date(now).toISOString(),status:'healthy',framesDecoded:150,freezeEvents:0,blackEvents:0,silenceEvents:0,issues:[],playbackTransportChecked:true}]};
test('rejects malformed reports, stale timestamps and false healthy claims',()=>{
  assert.equal(acceptPlaybackObservation({...base,cameras:[]},now),false);
  assert.equal(acceptPlaybackObservation({...base,checkedAt:new Date(now-180000).toISOString()},now),false);
  assert.equal(acceptPlaybackObservation({...base,youtubePlatformVerified:true},now),false);
  assert.equal(acceptPlaybackObservation({...base,cameras:[{...base.cameras[0],status:'healthy',issues:['freeze']}]},now),false);
});
test('accepts sanitized report but never claims platform verification',()=>{
  assert.equal(acceptPlaybackObservation({...base,playbackUrl:'SECRET_URL',cameras:[{...base.cameras[0],extra:'SECRET'}]},now),true);
  const state=getPlaybackObservation(now);
  assert.equal(state.stale,false);
  assert.equal(state.youtubePlatformVerified,false);
  assert.equal(JSON.stringify(state).includes('SECRET'),false);
  assert.equal(getPlaybackObservation(now+120000).report,null);
});
