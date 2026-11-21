import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {validateStoragePlan, calculateStoragePlan, measureRecordingDisk} from "../apps/node-service/src/storage-readiness.ts";

test("default eight-camera ten-hour plan produces plausible output",()=>{
 const p=calculateStoragePlan(validateStoragePlan({}));
 assert.equal(p.uploadMbps,48);
 assert.equal(p.estimatedBytes,8*8*1e6/8*10*3600);
 assert.ok(p.recommendedWriteMiBps>p.writeMiBps);
});
test("plan validates camera count, bitrate, and safety factor",()=>{
 assert.throws(()=>validateStoragePlan({cameras:0}),/cameras/);
 assert.throws(()=>validateStoragePlan({cameras:1.5}),/integer/);
 assert.throws(()=>validateStoragePlan({hours:100}),/hours/);
 assert.throws(()=>validateStoragePlan({safetyFactor:0.5}),/safetyFactor/);
});
test("free capacity and measured throughput are evaluated independently",()=>{
 const p=validateStoragePlan({cameras:2,recordingMbpsPerCamera:8,hours:1});
 const estimate=calculateStoragePlan(p,100,1);
 assert.equal(estimate.capacityEnough,false);
 assert.equal(estimate.throughputEnough,false);
 const enough=calculateStoragePlan(p,1e12,100);
 assert.equal(enough.capacityEnough,true);
 assert.equal(enough.throughputEnough,true);
});
test("benchmark writes and cleans temporary files",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"tsm-disk-test-"));
 try {
   const result=await measureRecordingDisk(dir,16);
   assert.equal(result.sampleMiB,16);
   assert.ok(result.measuredWriteMiBps>0);
   assert.deepEqual(await readdir(dir),[]);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test("benchmark rejects oversized and undersized requests",async()=>{
 await assert.rejects(measureRecordingDisk(tmpdir(),512),/16 to 256/);
 await assert.rejects(measureRecordingDisk(tmpdir(),1),/16 to 256/);
});
