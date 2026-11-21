import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=read('apps/dashboard/src/App.tsx'),css=read('apps/dashboard/src/App.css'),display=read('apps/dashboard/src/TournamentDisplayExtras.tsx'),presentation=read('apps/dashboard/src/Presentation.tsx'),slides=read('apps/dashboard/src/TournamentSlides.tsx'),api=read('apps/node-service/src/api.ts');
test('notifications show active count and separate new count; no acknowledged critical fallback',()=>{
 const notifications=read('apps/dashboard/src/GlobalNotifications.tsx');assert.match(notifications,/Notifications \(\{alerts.length\}\)/);assert.match(notifications,/\{unacknowledged.length\} new/);assert.doesNotMatch(notifications,/\|\| critical\.find/);
});
test('presentation rotation cannot start or stop physical camera devices',()=>{
 assert.doesNotMatch(display,/\/api\/previews\/start|method:\s*['"]POST|\/api\/previews\/\$\{[^}]*\}\/stop/);assert.match(display,/\/api\/display-sources/);assert.match(display,/controller\?\.abort\(\)/);assert.match(display,/img\.close\(\)/);assert.match(display,/visibilitychange/);
 const route=api.slice(api.indexOf('app.get("/api/display-sources"'),api.indexOf('app.get("/api/captures/:cameraId/frame"'));
 assert.doesNotMatch(route,/previewProcessManager\.start|previewSessionManager\.start|cameraCaptureManager\.start/);assert.match(route,/res\.on\("close", cleanup\)/);assert.match(route,/res.writableNeedDrain/);
});
test('links lead to distinct display modes, and ring times accept bounded saved styling',()=>{
 for(const mode of ['cameras','schedule'])assert.match(app,new RegExp('/presentation\\?mode='+mode));
 assert.doesNotMatch(app,/presentation\?mode=billboard/);assert.match(presentation,/get\("mode"\) === "cameras" \? "cameras" : "schedule"/);assert.match(presentation,/mode === "cameras"/);assert.match(slides,/Time text colour/);assert.match(slides,/Time alignment/);const validator=read('apps/node-service/src/tournament-displays.ts');assert.match(validator,/timeStyle/);assert.match(validator,/\^#\[0-9a-fA-F\]\{6\}\$/);
});
test('main operator areas use common shell, compact links and full-width stream keys',()=>{
 for(const section of ['Live Health','Advanced tools and reports','Fleet monitoring details'])assert.match(app,new RegExp('<details className="operator-advanced-shell" aria-label="'+section+'"'));
 assert.match(app,/<summary>Settings<\/summary>/);assert.match(app,/<summary>Advanced Tools<\/summary>/);assert.match(app,/<summary>Fleet Monitoring<\/summary>/);assert.match(app,/session-results-grid/);assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto/);assert.doesNotMatch(app,/warning below 50 GiB, critical below 10 GiB/);
});
