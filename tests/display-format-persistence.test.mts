import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('ring assignment time styles and clock settings survive save and reload; invalid styles are stripped', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'tsm-display-format-'));
  const old=process.cwd();process.chdir(dir);
  try {
    const {installTournamentDisplays}=await import('../apps/node-service/src/tournament-displays.ts');
    type Handler=(req:any,res:any)=>Promise<void>;
    let put:Handler|undefined,get:Handler|undefined;
    installTournamentDisplays({get:(_url:string,fn:Handler)=>{get=fn;},put:(_url:string,fn:Handler)=>{put=fn;}} as any);
    assert.ok(put&&get);
    async function send(handler:Handler,body?:unknown){let code=200;let value:any;const res={status(n:number){code=n;return this;},json(v:unknown){value=v;return this;},setHeader(){}};await handler({body},res);return {code,value};}
    const plan={revision:0,rotation:{enabled:false,cameraSeconds:20,motionThreshold:12,sponsorEvery:0,sponsorVideos:[],blacklist:[]},branding:{lines:[],clockSettings:{format:'24',seconds:false,color:'#ffcc00',size:32}},slides:[{id:'s1',title:'Ring assignment',duration:20,kind:'schedule',body:'',tables:[{heading:'Ring 1',subheading:'',rows:[{event:'Kata',time:'9:00 am',timeStyle:{weight:'bold',color:'#ffcc00',align:'right'}},{event:'Kumite',time:'After Kata',timeStyle:{weight:'bad',color:'url(unsafe)',align:'bad'}}]}]}]};
    const saved=await send(put,plan);assert.equal(saved.code,200);
    const loaded=await send(get);assert.equal(loaded.code,200);
    assert.deepEqual(loaded.value.branding.clockSettings,plan.branding.clockSettings);
    assert.deepEqual(loaded.value.slides[0].tables[0].rows[0].timeStyle,plan.slides[0].tables[0].rows[0].timeStyle);
    const rejected=loaded.value.slides[0].tables[0].rows[1].timeStyle;assert.equal(rejected.color,undefined);assert.equal(rejected.weight,undefined);assert.equal(rejected.align,undefined);
    assert.equal(loaded.value.slides[0].tables[0].rows[1].time,'After Kata');
  } finally {process.chdir(old);rmSync(dir,{recursive:true,force:true});}
});
