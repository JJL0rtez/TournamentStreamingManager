import test from "node:test";
import {spawnSync} from "node:child_process";
test("route audit",()=>{
 const run=spawnSync(process.execPath,["scripts/audit-output-routes.mjs"],{encoding:"utf8"});
 if(run.status!==0)throw new Error(run.stderr||run.stdout);
});
