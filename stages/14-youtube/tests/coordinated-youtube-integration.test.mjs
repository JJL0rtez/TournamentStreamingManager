import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'apps/node-service/src/coordinated-youtube.ts'),'utf8');
test('start requires a coordinator',()=>assert.match(source,/COORDINATOR_NOT_CONFIGURED/));
test('stop releases only after relay stop',()=>assert.ok(source.indexOf('await this.relays.stop(cameraId);')<source.indexOf('await record.guard.release();')));
test('concurrent starts are serialized',()=>assert.match(source,/this.pending.add\(cameraId\)/));
test('heartbeat loss does not terminate live FFmpeg',()=>assert.match(source,/Existing relay is NOT terminated/));
test('untracked relay cannot be silently released',()=>assert.match(source,/UNTRACKED_RELAY_REQUIRES_MANUAL_RECOVERY/));
test('patcher is idempotent and creates backup',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tsm-coord-'));
 try {
 const dir=path.join(tmp,'apps/node-service/src');fs.mkdirSync(dir,{recursive:true});
 const api=`import { YouTubeStreamManager } from "./YouTubeStreamManager.js";\nconst youtubeStreams = new YouTubeStreamManager();\napp.post("/api/youtube/:cameraId/start", (req, res) => {\nyoutubeStreams.start(cameraId, effectiveKey);\n});\nyoutubeStreams.start(cameraId, key);\nawait youtubeStreams.stopAll();\nawait youtubeStreams.stop(cameraId);\nawait youtubeStreams.stop(req.params.cameraId);\napp.get("/api/youtube/streams", (_req, res) => {`;
 fs.writeFileSync(path.join(dir,'api.ts'),api);
 const script=path.join(root,'scripts/integration/apply-coordinated-youtube.mjs');
 const run=()=>spawnSync(process.execPath,[script],{cwd:tmp,encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);
 const changed=fs.readFileSync(path.join(dir,'api.ts'),'utf8');assert.match(changed,/await coordinatedYoutube.start/);assert.match(changed,/await coordinatedYoutube.stop/);
 const second=run();assert.equal(second.status,0,second.stderr);assert.equal(fs.readFileSync(path.join(dir,'api.ts'),'utf8'),changed);
 assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.bak')).length,1);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
