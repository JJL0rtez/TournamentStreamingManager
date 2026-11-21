import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const api=readFileSync(new URL("../apps/node-service/src/api.ts",import.meta.url),"utf8");
const capture=api.split('app.post("/api/captures/start"')[1]?.split('app.get("/api/previews"')[0]||"";
test("only capture route opts into diagnostic authorization",()=>{
 assert.match(capture,/diagnosticCaptureAllowed: process.env.TSM_ENABLE_LOCAL_DIAGNOSTICS/);
 assert.equal((api.match(/diagnosticCaptureAllowed:/g)||[]).length,1);
});
test("capture manager receives diagnostic mode",()=>assert.match(capture,/req.body\?\.mode === "diagnostic" \? "diagnostic" : "production"/));
test("relay routes remain separate",()=>assert.match(api,/app.post\("\/api\/youtube\/:cameraId\/start"/));
