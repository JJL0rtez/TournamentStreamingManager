import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const api=readFileSync(new URL("../apps/node-service/src/api.ts",import.meta.url),"utf8");
const manager=readFileSync(new URL("../apps/node-service/src/camera-capture-manager.ts",import.meta.url),"utf8");
const capture=readFileSync(new URL("../apps/node-service/src/camera-capture.ts",import.meta.url),"utf8");
test("five production output-start endpoints retain central guard",()=>{
 for(const route of ["/api/captures/start","/api/recordings/start","/api/session/start-all","/api/youtube/:cameraId/start","/api/youtube/start-all"]){
  const start=api.indexOf(`app.post("${route}"`);assert.ok(start>=0,route);
  assert.match(api.slice(start,start+950),/evaluateOutputStart/);
 }
});
test("capture recovery preserves diagnostic mode",()=>{assert.match(api,/const wasRecording = managed\.recordingEnabled/);assert.match(api,/wasRecording, managed\.outputMode/);});
test("camera manager passes output mode to FFmpeg",()=>assert.match(manager,/recordingEnabled,\s*outputMode,\s*audioSyncOffsetMs/));
test("both recording and transport are diagnostic filtered",()=>{
 assert.match(capture,/\[recdiag\]/);assert.match(capture,/\[streamdiag\]/);
});
test("relay blocks diagnostic capture pending verification",()=>assert.match(api,/DIAGNOSTIC_RELAY_REQUIRES_VERIFICATION/));
