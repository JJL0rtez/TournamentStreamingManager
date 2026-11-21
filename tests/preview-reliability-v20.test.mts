import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PreviewJpegParser } from '../apps/node-service/src/preview-jpeg.js';
import { guardFfmpegPipes, requestFfmpegQuit } from '../apps/node-service/src/ffmpeg-pipes.js';
import { buildPreviewFfmpegArgs } from '../apps/node-service/src/PreviewFfmpeg.js';

test('JPEG parser preserves a start or end marker split across FFmpeg chunks',()=>{
 const parser=new PreviewJpegParser(),frames:Buffer[]=[];
 for(const chunk of [[70,0xff],[0xd8,1,2,0xff],[0xd9,0xff,0xd8,3],[0xff,0xd9]]) parser.push(Buffer.from(chunk),f=>frames.push(f));
 assert.deepEqual(frames.map(f=>[...f]),[[255,216,1,2,255,217],[255,216,3,255,217]]);
});
test('JPEG parser recovers after an oversized broken frame',()=>{
 const parser=new PreviewJpegParser(),frames:Buffer[]=[]; const accept=(f:Buffer)=>frames.push(f);
 parser.push(Buffer.from([255,216]),accept); parser.push(Buffer.alloc(8*1024*1024,1),accept);
 parser.push(Buffer.from([255,216,7,255,217]),accept); assert.equal(frames.length,1); assert.equal(frames[0][2],7);
});
test('FFmpeg EPIPE is handled even when a child exits during a quit write',async()=>{
 const failure=Object.assign(new Error('closed pipe'),{code:'EPIPE'});
 const stdin=new Writable({write(_chunk,_encoding,callback){callback(failure);}});
 let killed=0,reported=0;const child={stdin,stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,kill(){killed++;return true;}} as unknown as ChildProcess;
 guardFfmpegPipes(child,()=>reported++); const closed=new Promise<void>(resolve=>stdin.once('close',resolve));requestFfmpegQuit(child);await closed;
 assert.ok(killed>=1);assert.ok(reported>=1);child.stdout!.destroy();child.stderr!.destroy();
});
test('preview ffmpeg uses errors-only logging while preserving camera ID and frame sampling',()=>{
 const args=buildPreviewFfmpegArgs('device-unique');assert.equal(args[args.indexOf('-loglevel')+1],'error');assert.ok(args.includes('video=device-unique'));assert.ok(args.includes('fps=5,scale=640:360'));
});
test('camera cards use independent bounded polling rather than a dashboard frame tick',async()=>{
 const app=await readFile('apps/dashboard/src/App.tsx','utf8');const component=await readFile('apps/dashboard/src/CameraPreviewImage.tsx','utf8');assert.doesNotMatch(app,/setFrameTick/);assert.match(app,/<CameraPreviewImage/);assert.match(component,/if\(disposed\|\|document.hidden\|\|pending\)return/);assert.match(component,/URL.revokeObjectURL/);assert.match(component,/request\?\.abort\(\)/);
});
test('camera editor uses fixed-size stage and favicon is explicitly linked',async()=>{
 const css=await readFile('apps/dashboard/src/Presentation.css','utf8'),view=await readFile('apps/dashboard/src/Presentation.tsx','utf8'),html=await readFile('apps/dashboard/index.html','utf8');assert.match(css,/presentation-camera-editor-preview\{[^}]*width:25%/);assert.match(css,/grid-template-rows:auto minmax\(0,1fr\)/);assert.match(view,/mode === "cameras" && editing && !fullscreen \? "presentation-camera-editor-preview"/);assert.match(html,/href="\/favicon.svg"/);
});

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PreviewProcessManager } from '../apps/node-service/src/PreviewProcessManager.js';

test('two preview processes remain independent when one fails and its camera can be restarted', {timeout:15000}, async()=>{
 const children=new Map<string,ChildProcessWithoutNullStreams>();
 const script=`process.stdout.write(Buffer.from([255,216,1,255,217]));process.stdin.on('data',data=>{if(data.toString().includes('q'))process.exit(0);});setInterval(()=>process.stdout.write(Buffer.from([255,216,2,255,217])),50);`;
 const manager=new PreviewProcessManager(id=>{
   const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.set(id,child);return child;
 });
 try {
   await Promise.all([manager.start('camera-a'),manager.start('camera-b')]);
   assert.equal(manager.isRunning('camera-a'),true);assert.equal(manager.isRunning('camera-b'),true);
   await assert.rejects(manager.start('camera-a'),/already starting, running or stopping/);
   const child=children.get('camera-a')!;const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));child.kill();await exited;
   assert.equal(manager.isRunning('camera-a'),false);assert.equal(manager.getFrame('camera-a'),null);assert.match(manager.getStats('camera-a').error??'',/FFmpeg preview exited/);assert.equal(manager.isRunning('camera-b'),true);
   await manager.start('camera-a');assert.ok(manager.getFrame('camera-a'));assert.equal(manager.getStats('camera-a').error,null);
   await Promise.all([manager.stop('camera-a'),manager.stop('camera-a')]);assert.ok(!manager.isRunning('camera-a'));assert.ok(manager.isRunning('camera-b'));
 } finally { await Promise.allSettled([manager.stop('camera-a'),manager.stop('camera-b')]);for(const child of children.values())if(child.exitCode===null&&child.signalCode===null)child.kill(); }
});
