import {test} from "node:test";
import {strict as assert} from "node:assert";
import {deduplicateEvents} from "../apps/node-service/src/diagnostic-events.ts";
test("repeat observations collapse but separate cameras remain distinct",()=>{
 const make=(id:string,cameraId:string,timestamp:string)=>({id,timestamp,nodeId:"pc",cameraId,category:"camera" as const,severity:"warning" as const,code:"disconnected",message:"Camera lost"});
 const result=deduplicateEvents([make("old","a","2026-11-19T01:00:00Z"),make("new","a","2026-11-19T02:00:00Z"),make("other","b","2026-11-19T01:00:00Z")]);
 assert.equal(result.length,2);assert.equal(result[0].id,"new");
});
