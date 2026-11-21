import {test} from "node:test";
import {strict as assert} from "node:assert";
import {checkOutputEntitlement} from "../apps/node-service/src/production-modes.ts";
test("one free ring can stream and record cleanly",()=>assert.equal(checkOutputEntitlement({kind:"free",cleanRingLimit:1},[{mode:"production",cameraId:"one",stream:true,record:true}]).allowed,true));
test("two clean free rings are rejected by policy helper",()=>assert.equal(checkOutputEntitlement({kind:"free",cleanRingLimit:1},[{mode:"production",cameraId:"one",stream:true,record:true},{mode:"production",cameraId:"two",stream:true,record:false}]).allowed,false));
test("diagnostic jobs are not limited by clean production count",()=>assert.equal(checkOutputEntitlement({kind:"free",cleanRingLimit:1},Array.from({length:12},(_,i)=>({mode:"diagnostic" as const,cameraId:String(i),stream:true,record:true}))).allowed,true));
