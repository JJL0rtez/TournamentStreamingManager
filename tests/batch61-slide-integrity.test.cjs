const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require(process.env.TYPESCRIPT_PATH||require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()+'/typescript');
const root=path.resolve(__dirname,'..');
const dashboard=fs.readFileSync(path.join(root,'apps/dashboard/src/TournamentSlides.tsx'),'utf8');
const server=fs.readFileSync(path.join(root,'apps/node-service/src/tournament-displays.ts'),'utf8');
test('dashboard and server transpile without syntax diagnostics',()=>{
 for(const [name,source,kind] of [['dashboard',dashboard,ts.ScriptKind.TSX],['server',server,ts.ScriptKind.TS]]){
  const result=ts.transpileModule(source,{fileName:kind===ts.ScriptKind.TSX?'Slides.tsx':'server.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
  assert.deepEqual(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],name);
 }
});
test('presentation uses Batch 60 CSS without reverting',()=>{
 const css=fs.readFileSync(path.join(root,'apps/dashboard/src/TournamentSlides.css'),'utf8');
 assert.match(css,/Batch 60/);assert.match(css,/\.presentation-root:not\(\.presentation-fullscreen\) \.presentation-content>\.ts-display\{min-height:0\}/);
});
test('poll responses cannot overwrite a pending publish',()=>{
 assert.match(dashboard,/if\(dirty\.current\|\|saving\.current\)return/);
 assert.match(dashboard,/version===requestVersion\.current/);
 assert.match(dashboard,/requestVersion\.current\+\+/);
});
test('publish is serialized and keeps the draft on failure',()=>{
 assert.match(dashboard,/if\(saving\.current\)/);
 assert.match(dashboard,/if\(ok\)dirty\.current=false/);
 assert.match(dashboard,/Your unsaved draft is preserved/);
});
function makeServer(){
 const js=ts.transpileModule(server,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const routes={};let content=null;
 const mocks={'node:fs/promises':{mkdir:async()=>{},readFile:async()=>{if(content===null){const e=new Error('missing');e.code='ENOENT';throw e;}return content;},writeFile:async(_file,data)=>{content=data;},rename:async()=>{}},'node:path':require('node:path')};
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:(name)=>mocks[name]||require(name),process:{cwd:()=>'/tmp',pid:123},console});
 module.exports.installTournamentDisplays({get:(url,fn)=>routes[url+' GET']=fn,put:(url,fn)=>routes[url+' PUT']=fn});
 const send=async(body)=>{let code=200,value;const res={status(n){code=n;return this;},setHeader(){},json(v){value=v;return this;}};await routes['/api/tournament-displays PUT']({body},res);return {code,value};};
 return {send};
}
const base={revision:0,slides:[],rotation:{enabled:false,cameraSeconds:20,motionThreshold:12,sponsorEvery:0,sponsorVideos:[],blacklist:[]}};
const slide=(id)=>({id,title:'Announcement',duration:20,kind:'announcement',tables:[],body:'Hello'});
test('server rejects duplicate slide identifiers',async()=>{const {send}=makeServer();const r=await send({...base,slides:[slide('a'),slide('a')]});assert.equal(r.code,400);assert.match(r.value.error,/Duplicate/);});
test('server rejects empty identifiers',async()=>{const {send}=makeServer();assert.equal((await send({...base,slides:[slide('')]})).code,400);});
test('server rejects invalid table and row objects without crashing',async()=>{const {send}=makeServer();assert.equal((await send({...base,slides:[{...slide('a'),tables:[null]}]})).code,400);});
test('server rejects unsafe sponsor video list entries',async()=>{const {send}=makeServer();const r=await send({...base,rotation:{...base.rotation,sponsorVideos:['/api/anything']}});assert.equal(r.code,400);});
test('server accepts a valid slide and checks revision conflicts',async()=>{const {send}=makeServer();const ok=await send({...base,slides:[slide('one')]});assert.equal(ok.code,200);assert.equal(ok.value.revision,1);const conflict=await send({...base,slides:[slide('two')]});assert.equal(conflict.code,409);});
