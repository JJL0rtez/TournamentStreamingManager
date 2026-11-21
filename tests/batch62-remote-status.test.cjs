const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const remote = fs.readFileSync(path.join(root,'apps/node-service/src/remote-nodes.ts'),'utf8');
const dashboard = fs.readFileSync(path.join(root,'apps/dashboard/src/App.tsx'),'utf8');
const panel = fs.readFileSync(path.join(root,'apps/dashboard/src/DistributedOwnershipPanel.tsx'),'utf8');
const slides = fs.readFileSync(path.join(root,'apps/dashboard/src/TournamentSlides.tsx'),'utf8');
for(const route of ['captures/distributed-ownership','captures/distributed-reconciliation','youtube/distributed-reconciliation']) {
 test(`remote read-only proxy permits ${route}`,()=>{
   assert.match(remote,new RegExp('\\^\\\\/api\\\\/'+route.replaceAll('/','\\\\/')+'\\$'));
   assert.ok(remote.includes(`targetPath === "/api/${route}"`));
 });
}
test('remote proxy still restricts HTTP verbs',()=>{
 assert.match(remote,/readOnly && req\.method !== "GET"/);
 assert.match(remote,/allowedRemoteNodeRoutes\.some/);
});
test('status panel has no write operations',()=>{
 assert.match(panel,/Promise\.all/);
 assert.match(panel,/setInterval/);
 assert.doesNotMatch(panel,/method\s*:\s*["'](?:POST|PUT|DELETE)/);
 assert.doesNotMatch(panel,/restart\(/);
});
test('status panel is visible per node and uses proxy-aware requester',()=>{
 assert.match(dashboard,/DistributedOwnershipPanel requestNode=\{requestNode\} connected=\{connected\}/);
});
test('publishing conflict does not replace local document',()=>{
 assert.match(slides,/if\(r\.status===409\)\{conflict=true;setMessage/);
 assert.doesNotMatch(slides,/if\(r\.status===409\)\{setDoc/);
});
test('publish tracks edits made while saving',()=>{
 assert.match(slides,/versionAtStart===editVersion\.current/);
});
test('changed TS and TSX files are syntactically valid',()=>{
 const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
 for(const name of ['apps/node-service/src/remote-nodes.ts','apps/dashboard/src/App.tsx','apps/dashboard/src/TournamentSlides.tsx','apps/dashboard/src/DistributedOwnershipPanel.tsx']){
  const content=fs.readFileSync(path.join(root,name),'utf8');
  const result=ts.transpileModule(content,{fileName:name,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],name);
 }
});
