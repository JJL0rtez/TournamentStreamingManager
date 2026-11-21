import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const patcher=path.resolve('scripts/integration/apply-unified-capture.mjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tsm-patcher-'));const dir=path.join(root,'apps/node-service/src');fs.mkdirSync(dir,{recursive:true});return {root,file:path.join(dir,'api.ts')};}
const base=`import { YouTubeStreamManager } from "./YouTubeStreamManager.js";\nconst cameraCaptureManager = new CameraCaptureManager();\nconst recordingManager = new RecordingManager();\nconst youtubeStreams = new YouTubeStreamManager();\nconst coordinatedYoutube = new CoordinatedYouTube(youtubeStreams);\napp.get("/api/youtube/coordination", (_req, res) => {});\nawait coordinatedYoutube.start(cameraId, key);\nawait youtubeStreams.stop(cameraId);\n`;
test('legacy patcher refuses to rewrite APIs without an installed ownership-readiness route',()=>{
 const {root,file}=fixture();try{
  fs.writeFileSync(file,base);
  const r=spawnSync(process.execPath,[patcher],{cwd:root,encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/BATCH22_READINESS_ROUTE_MISSING/);
  assert.equal(fs.readFileSync(file,'utf8'),base);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(f=>f.endsWith('.bak')).length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('patcher refuses uncoordinated direct YouTube starts without touching source',()=>{const {root,file}=fixture();try{const src=base+'youtubeStreams.start(cameraId,key);';fs.writeFileSync(file,src);const r=spawnSync(process.execPath,[patcher],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0);assert.equal(fs.readFileSync(file,'utf8'),src);}finally{fs.rmSync(root,{recursive:true,force:true});}});
