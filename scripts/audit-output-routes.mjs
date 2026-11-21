import {readFileSync} from "node:fs";
const api=readFileSync(new URL("../apps/node-service/src/api.ts",import.meta.url),"utf8");
const routes=["/api/captures/start","/api/recordings/start","/api/session/start-all","/api/youtube/:cameraId/start","/api/youtube/start-all"];
for(const route of routes){
 const escaped=route.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 if(!api.includes(route)) throw Error(`Missing expected route ${route}`);
}
const matches=[...api.matchAll(/evaluateOutputStart\s*\(/g)];
if(matches.length<5)throw Error(`Only ${matches.length} guarded output routes found; expected at least 5`);
if(!api.includes('TSM_ENABLE_LOCAL_DIAGNOSTICS'))throw Error("Local diagnostic opt-in missing");
if(!api.includes('CAPTURE_MODE_TRANSITION_REQUIRES_STOP'))throw Error("Mode transition guard missing");
console.log(`PASS: ${routes.length} expected routes present; ${matches.length} authorization checks; transition and opt-in guards found`);
