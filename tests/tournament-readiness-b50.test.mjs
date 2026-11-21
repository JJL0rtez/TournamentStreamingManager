import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArgs,summarize,inspectRecordings,inspectEndpoints,runReadiness} from '../tools/tournament-readiness.mjs';

test('arguments reject invalid thresholds',()=>assert.throws(()=>parseArgs(['--min-free-gb','-1'])));
test('arguments reject endpoint credentials and query',()=>assert.throws(()=>parseArgs(['--endpoint','https://u:p@example.com/?token=secret'])));
test('arguments reject unsupported schemes',()=>assert.throws(()=>parseArgs(['--endpoint','file:///etc/passwd'])));
test('summarize reports fail before warnings',()=>assert.equal(summarize([{status:'warn'},{status:'fail'}]).status,'fail'));
test('empty recording folder warns',async()=>{const d=await mkdtemp(join(tmpdir(),'tsm-b50-'));try{const x=await inspectRecordings([d]);assert.equal(x[0].status,'warn');}finally{await rm(d,{recursive:true,force:true});}});
test('zero byte recording fails',async()=>{const d=await mkdtemp(join(tmpdir(),'tsm-b50-'));try{await writeFile(join(d,'empty.mkv'),'');const x=await inspectRecordings([d]);assert.equal(x[0].status,'fail');}finally{await rm(d,{recursive:true,force:true});}});
test('ffprobe validates video duration',async()=>{const d=await mkdtemp(join(tmpdir(),'tsm-b50-'));try{await writeFile(join(d,'test.mkv'),'abc');const x=await inspectRecordings([d],{probeMedia:true,command:async()=>({ok:true,stdout:JSON.stringify({streams:[{codec_type:'video',codec_name:'h264'}],format:{duration:'15'}})})});assert.equal(x[0].status,'pass');}finally{await rm(d,{recursive:true,force:true});}});
test('ffprobe missing video fails',async()=>{const d=await mkdtemp(join(tmpdir(),'tsm-b50-'));try{await writeFile(join(d,'test.mkv'),'abc');const x=await inspectRecordings([d],{probeMedia:true,command:async()=>({ok:true,stdout:JSON.stringify({streams:[],format:{duration:'15'}})})});assert.equal(x[0].status,'fail');}finally{await rm(d,{recursive:true,force:true});}});
test('endpoint failures do not disclose response body',async()=>{const x=await inspectEndpoints(['https://example.com/health'],{fetchFn:async()=>({ok:false,status:503})});assert.equal(x[0].status,'fail');assert.match(x[0].detail,/503/);});
test('readiness checks free disk and tool availability',async()=>{const d=await mkdtemp(join(tmpdir(),'tsm-b50-'));try{const o=parseArgs(['--recordings',d,'--min-free-gb','10']);const r=await runReadiness(o,{command:async()=>({ok:true}),freeSpaceFn:async()=>5e9});assert.equal(r.summary.status,'fail');assert.equal(r.checks.find(x=>x.name==='disk-free').status,'fail');}finally{await rm(d,{recursive:true,force:true});}});
