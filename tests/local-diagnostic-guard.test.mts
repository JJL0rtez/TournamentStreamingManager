import assert from "node:assert/strict";
import test from "node:test";
import {evaluateOutputStart} from "../apps/node-service/src/output-start-guard.ts";
const request = (requestedMode: unknown, diagnosticCaptureAllowed=false) => ({requestedMode,cameraIds:["cam1","cam2"],activeCameraIds:["cam3"],enforcementEnabled:true,diagnosticCaptureAllowed});
test("diagnostic requests denied without opt-in",()=>assert.equal(evaluateOutputStart(request("diagnostic")).code,"DIAGNOSTIC_PIPELINE_NOT_READY"));
test("diagnostic local capture allowed with opt-in regardless of number of cameras",()=>assert.equal(evaluateOutputStart(request("diagnostic",true)).code,"WATERMARKED_LOCAL_DIAGNOSTIC"));
test("clean multi-camera production remains blocked",()=>assert.equal(evaluateOutputStart(request("production",true)).code,"FREE_RING_LIMIT"));
test("invalid output mode is always rejected",()=>assert.equal(evaluateOutputStart(request("unknown",true)).status,400));
test("diagnostic opt-in does not override mode validation",()=>assert.equal(evaluateOutputStart(request(null,true)).code,"INVALID_OUTPUT_MODE"));
