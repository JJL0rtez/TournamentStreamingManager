import {test,expect} from '@playwright/test';
const node={id:'local',name:'Tournament PC',online:true,local:true};
async function fixture(page){
 const responses={'/api/nodes':{nodes:[node]},'/api/auth/status':{configured:false},'/api/devices':{cameras:[],microphones:[]},'/api/session':{session:{eventName:'Acceptance Tournament',eventId:'test-event',assignments:[]}},'/api/session/events':{events:[]},'/api/session/templates':{templates:[]},'/api/captures':{captures:[]},'/api/captures/health':{captures:[]},'/api/previews':{previews:[]},'/api/youtube/streams':{streams:[]},'/api/recording-events':{events:[]},'/api/camera-health/usb-warnings':{warnings:[]},'/api/settings':{settings:{devices:{},network:{mode:'offline',bindAddress:'127.0.0.1'}}}};
 await page.route('**/api/**',route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({status:responses[pathname]?200:503,json:responses[pathname]||{error:'Fixture does not provide this diagnostic'}});});
 await page.goto('/');await expect(page.getByRole('button',{name:'Live Operations',exact:true})).toBeVisible();
}
test('operator navigation separates tournament setup from live controls',async({page})=>{
 await fixture(page);await expect(page.getByRole('button',{name:'Start All Recordings',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Tournament Setup',exact:true}).click();await expect(page.getByPlaceholder('e.g. Fall Championship 2026')).toBeVisible();await expect(page.getByRole('button',{name:'Start All Recordings',exact:true})).toBeHidden();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('button',{name:'Recording drive & hardware',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Maintenance',exact:true}).click();await expect(page.getByRole('heading',{name:'Testing & Diagnostics',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Live Operations',exact:true}).click();await expect(page.getByRole('button',{name:'Start All Recordings',exact:true})).toBeVisible();
});
test('acknowledgement removes banner but preserves active incident',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tournament:operations-alerts',{detail:{nodeId:'fixture',nodeName:'Fixture node',online:true,alerts:[{key:'fixture-warning',severity:'critical',message:'Fixture incident'}]}})));
 const banner=page.locator('.global-notification-banner');await expect(banner).toContainText('Fixture incident');await banner.getByRole('button',{name:'Acknowledge',exact:true}).click();await expect(banner).not.toContainText('Fixture incident');
 await page.getByRole('button',{name:/Notifications:/}).click();await expect(page.getByRole('region',{name:'Active streaming alerts'})).toContainText('Acknowledged, still active');
});
test('acknowledgement survives reload and an incomplete health snapshot',async({page})=>{
 await fixture(page);
 const incident={key:'reload-test',severity:'critical',message:'Persistent test incident'};
 await page.evaluate(alert=>window.dispatchEvent(new CustomEvent('tournament:operations-alerts',{detail:{nodeId:'reload-fixture',nodeName:'Reload fixture',online:true,complete:true,alerts:[alert]}})),incident);
 await page.locator('.global-notification-banner').getByRole('button',{name:'Acknowledge',exact:true}).click();
 await page.reload();
 await expect(page.getByRole('button',{name:'Live Operations',exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tournament:operations-alerts',{detail:{nodeId:'reload-fixture',nodeName:'Reload fixture',online:true,complete:false,alerts:[]}})));
 await page.evaluate(alert=>window.dispatchEvent(new CustomEvent('tournament:operations-alerts',{detail:{nodeId:'reload-fixture',nodeName:'Reload fixture',online:true,complete:true,alerts:[alert]}})),incident);
 await expect(page.locator('.global-notification-banner')).not.toContainText('Persistent test incident');
 await page.getByRole('button',{name:/Notifications:/}).click();
 await expect(page.getByRole('region',{name:'Active streaming alerts'})).toContainText('Acknowledged, still active');
});
