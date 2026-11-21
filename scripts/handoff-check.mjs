import { readFileSync } from "node:fs";
import { join } from "node:path";
const session=readFileSync(join("apps","node-service","src","tournament-session.ts"),"utf8");
const api=readFileSync(join("apps","node-service","src","api.ts"),"utf8");
for (const [name,text] of [["saved session",session],["draft preflight",api]]) {
 if (/assignments\.length\s*>\s*8/.test(text)) throw new Error(`${name} still has the eight-assignment ceiling`);
}
if(!api.includes('/api/session/capacity')) throw new Error('Missing capacity endpoint');
console.log('Handoff static checks passed');
