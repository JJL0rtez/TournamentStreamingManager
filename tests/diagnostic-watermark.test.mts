import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticSampleArgs, diagnosticVideoFilter } from "../apps/node-service/src/diagnostic-watermark.ts";

test("watermark filter has persistent and moving burned-in markings", () => {
  const filter = diagnosticVideoFilter();
  assert.match(filter, /TEST STREAM \/ DIAGNOSTIC MODE/);
  assert.match(filter, /mod\(t\*37/);
  assert.match(filter, /NOT FOR PRODUCTION/);
});
test("sample output always uses filter before video encoding", () => {
  const args = diagnosticSampleArgs({inputArgs:["-f","lavfi","-i","testsrc2=size=320x180:rate=10"], outputFile:"sample.mkv", durationSeconds:3});
  assert.ok(args.indexOf("-vf") < args.indexOf("-c:v"));
  assert.equal(args[args.indexOf("-vf")+1], diagnosticVideoFilter());
  assert.equal(args.at(-1), "sample.mkv");
});
test("reject invalid sample duration and output", () => {
  assert.throws(()=>diagnosticSampleArgs({inputArgs:["-i","x"],outputFile:"x.mkv",durationSeconds:0}));
  assert.throws(()=>diagnosticSampleArgs({inputArgs:["-i","x"],outputFile:"x.mp4",durationSeconds:2}));
});
