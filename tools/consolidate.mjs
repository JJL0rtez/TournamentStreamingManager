import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '..');
const flags = new Set(process.argv.slice(2));
const get = key => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : undefined; };
const project = path.resolve(get('--project') || process.cwd());
const apply = flags.has('--apply');
const overwrite = flags.has('--overwrite');
const reportFile = get('--report') ? path.resolve(get('--report')) : path.join(project, 'tsm-consolidation-report.json');
const manifest = JSON.parse(fs.readFileSync(path.join(bundle,'manifest.json'),'utf8'));
if (!fs.existsSync(path.join(project,'package.json')) || !fs.existsSync(path.join(project,'apps','dashboard'))) throw Error('Target is not a TournamentStreaming project root: ' + project);
if (project === bundle || project.startsWith(bundle + path.sep)) throw Error('Project must be separate from bundle');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const staged = new Map(); const conflicts = []; const duplicate = [];
function walk(dir, prefix='') { let out=[]; for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {const rel=path.join(prefix,entry.name); if(entry.isDirectory()) out.push(...walk(path.join(dir,entry.name),rel)); else if(entry.isFile()) out.push(rel); }return out; }
for (const entry of manifest) {
 const dir=path.join(bundle,'stages',entry.stage);
 for(const rel of walk(dir)) {
  if (rel === 'README.md') continue;
  const src=path.join(dir,rel);const buf=fs.readFileSync(src);const key=rel.replaceAll('\\','/');
  if (staged.has(key)) {const old=staged.get(key);duplicate.push({path:key,previous:old.stage,next:entry.stage,changed:sha(old.buf)!==sha(buf)});}
  staged.set(key,{stage:entry.stage,buf});
 }
}
const operations=[];
for (const [rel, entry] of staged) {
 const dest=path.resolve(project,rel);
 if (!dest.startsWith(project + path.sep)) throw Error('Unsafe path: '+rel);
 const exists=fs.existsSync(dest);
 const same=exists && sha(fs.readFileSync(dest))===sha(entry.buf);
 const action=same?'unchanged':exists&&!overwrite?'conflict':exists?'replace':'add';
 if(action==='conflict') conflicts.push(rel);
 operations.push({path:rel,stage:entry.stage,action});
}
const report={project,createdAt:new Date().toISOString(),mode:apply?'apply':'dry-run',overwrite,stages:manifest.length,uniqueFiles:operations.length,stageCollisions:duplicate,conflicts,operations,backup:null};
if (apply) {
 const backup=path.join(project,'.tsm-consolidation-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
 const touched=operations.filter(x=>x.action==='add'||x.action==='replace');
 const written=[];
 try {
  for(const op of touched) {
   const target=path.join(project,op.path);
   if(op.action==='replace') {const saved=path.join(backup,op.path);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(target,saved);}
   fs.mkdirSync(path.dirname(target),{recursive:true});
   const temp=target+'.tsm-tmp-'+process.pid;
   fs.writeFileSync(temp,staged.get(op.path).buf);
   fs.renameSync(temp,target);
   written.push(op);
  }
  report.backup=backup;
  fs.mkdirSync(backup,{recursive:true});
  fs.writeFileSync(path.join(backup,'restore-manifest.json'),JSON.stringify({written,project},null,2));
 } catch(e) {
  for(const op of written.reverse()) {
   const target=path.join(project,op.path);const saved=path.join(backup,op.path);
   if(op.action==='add') fs.rmSync(target,{force:true});
   else if(fs.existsSync(saved))fs.copyFileSync(saved,target);
  }
  throw e;
 }
}
fs.mkdirSync(path.dirname(reportFile),{recursive:true});
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
const counts=Object.fromEntries(['add','replace','unchanged','conflict'].map(k=>[k,operations.filter(x=>x.action===k).length]));
console.log(JSON.stringify({mode:report.mode,project,stages:manifest.length,uniqueFiles:operations.length,counts,stageCollisions:duplicate.length,report:reportFile,backup:report.backup},null,2));
if(conflicts.length)console.log('Existing files were preserved. Review the report and merge changes, or use --overwrite only after committing your work.');
