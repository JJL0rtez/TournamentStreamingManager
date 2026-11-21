import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {slideTiming,sponsorFileLabel} from '../apps/dashboard/src/sponsor-timing.ts';
import {validateTournamentDisplays} from '../apps/node-service/src/tournament-displays.ts';
const url='/api/tournament-displays/media/12345678-1234-1234-1234-123456789abc.mp4';
const read=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('sponsor duration defaults to end event, explicit override uses timer',()=>{
 const s={kind:'sponsor',videoUrl:url,duration:20};
 assert.deepEqual(slideTiming(s),{mode:'media'});
 assert.deepEqual(slideTiming({...s,durationOverride:true}),{mode:'timer',seconds:20});
 assert.deepEqual(slideTiming({...s,videoUrl:''}),{mode:'timer',seconds:20});
 assert.deepEqual(slideTiming({...s,kind:'schedule'}),{mode:'timer',seconds:20});
});
test('sponsor filenames remain human-readable and never use internal identifiers',()=>{
 assert.equal(sponsorFileLabel(url,'Sponsor One.mp4',0),'Sponsor One.mp4');
 assert.equal(sponsorFileLabel(url,undefined,1),'Sponsor video 2 (original filename unavailable)');
 assert.equal(sponsorFileLabel('https://example.com/Old%20Sponsor.mp4',undefined,0),'Old Sponsor.mp4');
});
test('publication preserves duration override and filenames, drops unrelated filename metadata',()=>{
 const raw={slides:[{id:'1',kind:'sponsor',duration:20,durationOverride:true,title:'',videoUrl:url,videoName:'C:\\fakepath\\Sponsor One.mp4',tables:[]}],rotation:{enabled:true,cameraSeconds:20,motionThreshold:12,sponsorEvery:2,sponsorVideos:[url],sponsorVideoNames:{[url]:'Sponsor One.mp4',unrelated:'hidden'},blacklist:[]}};
 const saved=validateTournamentDisplays(raw);
 assert.equal(saved.slides[0].durationOverride,true);assert.equal(saved.slides[0].videoName,'Sponsor One.mp4');
 assert.deepEqual(saved.rotation.sponsorVideoNames,{[url]:'Sponsor One.mp4'});
 assert.equal(validateTournamentDisplays({...raw,slides:[{...raw.slides[0],durationOverride:undefined}]}).slides[0].durationOverride,false);
});
test('both displays use unmuted controls-free playback with graceful autoplay fallback',()=>{
 const player=read('apps/dashboard/src/SponsorPlayback.tsx');
 assert.match(player,/controls=\{false\}/);assert.doesNotMatch(player,/\bmuted\b/);assert.match(player,/Enable sponsor sound/);assert.match(player,/onEnded=/);
 assert.match(read('apps/dashboard/src/TournamentSlides.tsx'),/<SponsorPlayback/);assert.match(read('apps/dashboard/src/TournamentDisplayExtras.tsx'),/<SponsorPlayback/);
 assert.doesNotMatch(read('apps/dashboard/src/SponsorVideoPicker.tsx'),/Video URL/);
});
