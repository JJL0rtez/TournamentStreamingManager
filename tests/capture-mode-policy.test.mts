import test from "node:test";
import assert from "node:assert/strict";
import {validateCaptureModeChange,canUseProductionRelay} from "../apps/node-service/src/capture-mode-policy.ts";
test("default mode is production",()=>assert.equal(validateCaptureModeChange(null,undefined,false),"production"));
test("unknown mode is invalid",()=>assert.throws(()=>validateCaptureModeChange(null,"unmarked",false),/INVALID_OUTPUT_MODE/));
test("diagnostic cannot silently become clean",()=>assert.throws(()=>validateCaptureModeChange("diagnostic",undefined,true),/REQUIRES_STOP/));
test("production cannot silently become diagnostic",()=>assert.throws(()=>validateCaptureModeChange("production","diagnostic",true),/REQUIRES_STOP/));
test("stopped capture can change mode",()=>assert.equal(validateCaptureModeChange("production","diagnostic",false),"diagnostic"));
test("relay requires production",()=>{assert.equal(canUseProductionRelay("diagnostic"),false);assert.equal(canUseProductionRelay("production"),true)});
