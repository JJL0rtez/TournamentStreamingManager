import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SwitchableRecording, recordingSinkArgs, switchableRecordingEnabled} from '../apps/node-service/src/switchable-recording.ts';
test('independent recording requires explicit standalone opt-in',()=>{
 assert.equal(switchableRecordingEnabled({}),false);
 assert.equal(switchableRecordingEnabled({TOURNAMENT_DYNAMIC_RECORDING:'1'}),true);
 assert.equal(switchableRecordingEnabled({TOURNAMENT_DYNAMIC_RECORDING:'1',TSM_DISTRIBUTED_CAPTURE:'1'}),false);
 assert.ok(recordingSinkArgs('output_%04d.mkv').includes('copy'));
 assert.ok(recordingSinkArgs('output_%04d.mkv').includes('-n'));
});
test('two disk recording sessions finalize without stopping source', {skip:process.env.TSM_TEST_MEDIA!=='1',timeout:45000}, async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tsm-switch-'));
 const tap=new SwitchableRecording();
 const url=await tap.listen();
 const source=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=160x90:rate=15','-f','lavfi','-i','sine=frequency=480:sample_rate=48000','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-g','15','-c:a','aac','-f','mpegts','-mpegts_flags','+resend_headers',url]);
 source.stderr.resume();source.stdout.resume();
 const outcomes:boolean[]=[];
 try {
  const first=await tap.start(dir,(_p,success)=>outcomes.push(success));
  await new Promise(r=>setTimeout(r,1200)); await tap.stop();
  assert.equal(source.exitCode,null);
  const second=await tap.start(dir,(_p,success)=>outcomes.push(success));
  await new Promise(r=>setTimeout(r,1200)); await tap.stop();
  assert.equal(source.exitCode,null);assert.notEqual(first,second);
  assert.deepEqual(outcomes,[true,true]);
  for(const file of [first,second]) {
   const data=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
   assert.ok(data.streams.some((s:any)=>s.codec_type==='video'));
   assert.ok(data.streams.some((s:any)=>s.codec_type==='audio'));
   assert.ok(Number(data.format.duration)>0);
  }
 } finally {tap.dispose();source.kill();await rm(dir,{recursive:true,force:true});}
});
