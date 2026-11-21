import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2);const i=args.indexOf('--backup');if(i<0||!args[i+1])throw Error('Pass --backup <path>');
const backup=path.resolve(args[i+1]);const m=JSON.parse(fs.readFileSync(path.join(backup,'restore-manifest.json'),'utf8'));
const apply=args.includes('--apply');let n=0;
for(const op of [...m.written].reverse()){
 const dest=path.resolve(m.project,op.path);if(!dest.startsWith(m.project+path.sep))throw Error('Unsafe path');
 const saved=path.join(backup,op.path);if(op.action==='replace'&&!fs.existsSync(saved))throw Error('Missing backup '+saved);
 if(apply){if(op.action==='add')fs.rmSync(dest,{force:true});else{fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(saved,dest);}}n++;
}
console.log(`${apply?'Restored':'Would restore'} ${n} files`);
