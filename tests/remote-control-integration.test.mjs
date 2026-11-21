import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const installer=path.join(root,'scripts/integration/enable-remote-capture-controls.mjs');
const dashboardDir=path.resolve('apps/dashboard/src');
const backup=fs.existsSync(dashboardDir)?fs.readdirSync(dashboardDir).filter(name=>/^App\.tsx\.pre-remote-controls-.*\.bak$/.test(name)).sort().at(-1):null;
const original=process.env.TSM_TEST_APP_SOURCE||(backup?path.join(dashboardDir,backup):path.join(dashboardDir,'App.tsx'));
const exists=fs.existsSync(original);
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsm-remote-'));const app=path.join(dir,'App.tsx');fs.copyFileSync(original,app);return {dir,app};}
function run(app){return spawnSync(process.execPath,[installer,app],{encoding:'utf8'});}
test('fixture available',()=>assert.equal(exists,true,'Set TSM_TEST_APP_SOURCE to a current App.tsx path'));
test('installer adds opt-in, only remote capture commands, and backup',()=>{const {dir,app}=fixture();try{const result=run(app);assert.equal(result.status,0,result.stderr);const code=fs.readFileSync(app,'utf8');assert.match(code,/remoteCaptureControlsEnabled/);assert.match(code,/window\.confirm/);assert.match(code,/method === "POST"/);assert.match(code,/\/api\\\/captures\\\/start/);assert.match(code,/remoteCaptureAllowed \|\| !connected \|\| busy/);assert.match(code,/savedProfiles\[camera\.id\]/);assert.ok(fs.readdirSync(dir).filter(f=>f.endsWith('.bak')).length <= 1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('installer is idempotent',()=>{const {dir,app}=fixture();try{assert.equal(run(app).status,0);const before=fs.readFileSync(app,'utf8');assert.equal(run(app).status,0);assert.equal(fs.readFileSync(app,'utf8'),before);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('installer refuses unknown dashboard without changing it',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsm-remote-'));const app=path.join(dir,'App.tsx');try{fs.writeFileSync(app,'unrelated content');assert.notEqual(run(app).status,0);assert.equal(fs.readFileSync(app,'utf8'),'unrelated content');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('remote command whitelist excludes settings, credentials and recovery',()=>{const code=fs.readFileSync(installer,'utf8');assert.doesNotMatch(code,/allowed =[^;]*profiles\/import/);assert.match(code,/This remote setting is not enabled/);assert.match(code,/method !== "GET"/);});
test('no automatic retries of mutation commands',()=>{const transportPath=path.resolve('apps/node-service/src/peer-transport.ts');if(!fs.existsSync(transportPath))return;const source=fs.readFileSync(transportPath,'utf8');assert.match(source,/method==="GET"\?ordered:ordered\.slice\(0,1\)/);assert.match(source,/if\(method!=="GET"\)break/);});
