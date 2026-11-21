import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptPlaybackObservation, getPlaybackObservation } from '../apps/node-service/src/playback-observation.ts';
const now = Date.now();
function report(observerId:string, cameraId:string, time = now) {
 const checkedAt = new Date(time).toISOString();
 return {schemaVersion:1, source:'independent-ffmpeg-playback', observerId, checkedAt, youtubePlatformVerified:false, cameras:[{ cameraId, checkedAt, status:'healthy', framesDecoded:100, freezeEvents:0, blackEvents:0, silenceEvents:0, issues:[], playbackTransportChecked:true}]};
}
test('different observers aggregate without overwriting each other',()=>{
 assert.equal(acceptPlaybackObservation(report('worker_a','cam_a'),now),true);
 assert.equal(acceptPlaybackObservation(report('worker_b','cam_b'),now),true);
 const state = getPlaybackObservation(now);
 assert.deepEqual(state.report?.cameras.map(c=>c.cameraId).sort(),['cam_a','cam_b']);
 assert.equal(state.youtubePlatformVerified,false);
});
test('out of order observation cannot overwrite latest state',()=>{
 assert.equal(acceptPlaybackObservation(report('worker_order','cam_new',now+500),now),true);
 assert.equal(acceptPlaybackObservation(report('worker_order','cam_old',now-500),now),false);
 assert.ok(getPlaybackObservation(now+500).report?.cameras.some(c=>c.cameraId==='cam_new'));
});
test('duplicate camera identities across observers become warnings',()=>{
 assert.equal(acceptPlaybackObservation(report('worker_dup1','cam_duplicate'),now),true);
 assert.equal(acceptPlaybackObservation(report('worker_dup2','cam_duplicate'),now),true);
 const state=getPlaybackObservation(now);
 assert.deepEqual(state.conflictingCameraIds,['cam_duplicate']);
 assert.equal(state.report?.cameras.filter(c=>c.cameraId==='cam_duplicate').every(c=>c.status==='warning'),true);
});
test('stale observers do not claim current health',()=>{
 const state=getPlaybackObservation(now+91_000);
 assert.equal(state.stale,true);
 assert.equal(state.report,null);
 assert.ok(state.observers.every(o=>o.stale));
});
test('invalid IDs and secret extras are rejected or stripped',()=>{
 assert.equal(acceptPlaybackObservation(report('../evil','cam_x'),now),false);
 assert.equal(acceptPlaybackObservation({...report('worker_secret','cam_secret'), secret:'DONT_LEAK', cameras:[{...report('worker_secret','cam_secret').cameras[0], playbackUrl:'DONT_LEAK'}]},now),true);
 assert.equal(JSON.stringify(getPlaybackObservation(now)).includes('DONT_LEAK'),false);
});
