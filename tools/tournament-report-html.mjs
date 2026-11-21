#!/usr/bin/env node
// Offline HTML report: no CDN, no JavaScript, no external dependencies.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderHtml(report){
 const checks=Array.isArray(report.results)?report.results:Array.isArray(report.checks)?report.checks:[];
 const rows=checks.map(c=>`<tr><td>${escapeHtml(c.phase??c.code??c.name??'check')}</td><td class="${c.status==='pass'?'pass':c.status==='warn'?'warn':'fail'}">${escapeHtml(c.status)}</td><td>${escapeHtml(c.detail??c.error??c.reportError??'')}</td></tr>`).join('\n');
 const name=escapeHtml(report.host??'Tournament');const status=escapeHtml(report.status??'unknown');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tournament readiness: ${name}</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;background:#f7f8fa;color:#17212b}header,main{background:white;border:1px solid #ddd;border-radius:12px;padding:24px;margin-bottom:18px}h1{margin-top:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}.pass{color:#176a3b;font-weight:700}.fail{color:#ad2626;font-weight:700}.warn{color:#916000;font-weight:700}small{color:#59636e}</style></head><body><header><h1>Tournament readiness: ${name}</h1><p>Overall status: <strong class="${status==='pass'?'pass':status==='warn'?'warn':'fail'}">${status}</strong></p><small>Generated: ${escapeHtml(report.generatedAt)}</small></header><main><h2>Checks</h2><table><thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table><p><small>This report is based on the supplied evidence. A pass does not certify live tournament operation.</small></p></main></body></html>`;
}
export async function main(args=process.argv.slice(2)){if(args.length!==2)throw Error('Usage: node tools/tournament-report-html.mjs INPUT.json OUTPUT.html');const report=JSON.parse(await readFile(args[0],'utf8'));await writeFile(args[1],renderHtml(report));console.log(resolve(args[1]));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=2;});
