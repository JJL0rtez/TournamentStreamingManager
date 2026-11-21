import fs from 'node:fs';
import path from 'node:path';
const file = path.resolve('apps/node-service/src/api.ts');
const before = fs.readFileSync(file,'utf8');
const marker = 'import { installUnifiedCaptureLifecycle } from "./unified-capture-integration.js";';
if(before.includes(marker)){console.log('Unified integration already applied');process.exit(0);}
let content=before;
function replaceExactlyOnce(from,to){const count=content.split(from).length-1;if(count!==1)throw Error(`Expected exactly one anchor (${count}): ${from}`);content=content.replace(from,to);}
replaceExactlyOnce('import { YouTubeStreamManager } from "./YouTubeStreamManager.js";', 'import { YouTubeStreamManager } from "./YouTubeStreamManager.js";\n'+marker);
const constructor='const youtubeStreams = new YouTubeStreamManager();';
if(!content.includes('const cameraCaptureManager = new CameraCaptureManager();')||!content.includes('const recordingManager = new RecordingManager();'))throw Error('Missing required capture managers');
// Install at the last manager construction, before any HTTP handlers can run.
replaceExactlyOnce(constructor,constructor+'\nconst unifiedCapture = installUnifiedCaptureLifecycle(cameraCaptureManager, recordingManager, youtubeStreams);');
// Previous YouTube-only coordinator must not acquire a SECOND lease for the same ring.
const old='const coordinatedYoutube = new CoordinatedYouTube(youtubeStreams);';
if(content.includes(old)) replaceExactlyOnce(old,'const coordinatedYoutube = unifiedCapture.youtube;');
else if(content.includes('coordinatedYoutube.'))throw Error('Unexpected YouTube coordination layout; manual reconciliation required');
// Reject unsupported direct relay start calls, except in the unified facade implementation.
const directStarts = [...content.matchAll(/youtubeStreams\.start\s*\(/g)];
if(directStarts.length)throw Error(`Found ${directStarts.length} direct YouTube start calls. Apply the coordinated YouTube lifecycle patch first.`);
// All remaining direct stop calls must use the unified facade or the ownership lease may leak.
content=content.replaceAll('await youtubeStreams.stopAll();','await unifiedCapture.youtube.stopAll();');
content=content.replaceAll('await youtubeStreams.stop(cameraId);','await unifiedCapture.youtube.stop(cameraId);');
content=content.replaceAll('await youtubeStreams.stop(req.params.cameraId);','await unifiedCapture.youtube.stop(req.params.cameraId);');
const remaining=[...content.matchAll(/youtubeStreams\.(?:stop|stopAll)\s*\(/g)];
if(remaining.length)throw Error('Unrecognized direct YouTube stop call remains; manual reconciliation required');
const anchor='app.get("/api/youtube/coordination",';
if(!content.includes(anchor))throw Error('Coordinated YouTube API not installed. Apply previous patch first.');
replaceExactlyOnce(anchor,'app.get("/api/captures/ownership", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({rings: unifiedCapture.status()}); });\n\n'+anchor);
const backup=file+'.pre-unified-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak';
fs.copyFileSync(file,backup);
const tmp=file+'.unified-tmp';
try{fs.writeFileSync(tmp,content);fs.renameSync(tmp,file);}catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
console.log('Installed unified recording + capture + YouTube ownership. Backup:',backup);
