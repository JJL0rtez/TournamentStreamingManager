import fs from 'node:fs';
import path from 'node:path';
const file = path.resolve('apps/node-service/src/api.ts');
const original = fs.readFileSync(file, 'utf8');
const marker = 'import { CoordinatedYouTube } from "./coordinated-youtube.js";';
if (original.includes(marker)) {console.log('Already installed, no changes.'); process.exit(0);}
let content = original;
function replaceOnce(from, to) {
  const count = content.split(from).length - 1;
  if (count !== 1) throw Error(`Expected one match, found ${count}: ${from.slice(0,80)}`);
  content = content.replace(from,to);
}
replaceOnce('import { YouTubeStreamManager } from "./YouTubeStreamManager.js";', 'import { YouTubeStreamManager } from "./YouTubeStreamManager.js";\n'+marker);
replaceOnce('const youtubeStreams = new YouTubeStreamManager();','const youtubeStreams = new YouTubeStreamManager();\nconst coordinatedYoutube = new CoordinatedYouTube(youtubeStreams);');
replaceOnce('app.post("/api/youtube/:cameraId/start", (req, res) => {','app.post("/api/youtube/:cameraId/start", async (req, res) => {');
for (const from of ['youtubeStreams.start(cameraId, effectiveKey);','youtubeStreams.start(cameraId, key);']) replaceOnce(from, 'await coordinatedYoutube.start('+ (from.includes('effectiveKey')?'cameraId, effectiveKey':'cameraId, key') +');');
// Only modify the dedicated relay routes and the known capture/session stop calls.
// Remaining occurrences of stopAll may exist; replace all to protect capture stop routes too.
content = content.replaceAll('await youtubeStreams.stopAll();','await coordinatedYoutube.stopAll();');
content = content.replaceAll('await youtubeStreams.stop(cameraId);','await coordinatedYoutube.stop(cameraId);');
content = content.replaceAll('await youtubeStreams.stop(req.params.cameraId);','await coordinatedYoutube.stop(req.params.cameraId);');
replaceOnce('app.get("/api/youtube/streams", (_req, res) => {', 'app.get("/api/youtube/coordination", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({claims: coordinatedYoutube.status()}); });\n\napp.get("/api/youtube/streams", (_req, res) => {');
// Write atomically and retain the exact prior version.
const backup = file+'.pre-coordination-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak';
fs.copyFileSync(file, backup);
const temp = file+'.coordination-tmp';
try {fs.writeFileSync(temp,content); fs.renameSync(temp,file);} catch (e) {try{fs.unlinkSync(temp);}catch{} throw e;}
console.log('Integrated coordinator into YouTube start/stop, bulk operations and capture stop routes. Backup:', backup);
