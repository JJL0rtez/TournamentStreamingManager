import { getSession } from './tournament-session.js';
// @ts-ignore JavaScript coordination package has standalone Node tests.
import { createUnifiedLifecycle } from '../../../packages/capture-coordination/unified-lifecycle.mjs';

/** Install at the API composition root, before any routes accept traffic.
 * This guards both recording implementations and YouTube using ONE ring lease. */
export function installUnifiedCaptureLifecycle(captures: any, recordings: any, youtube: any) {
  const gate = createUnifiedLifecycle({getSession,onIncident: (event: unknown) => console.error('[CAPTURE OWNERSHIP INCIDENT]', JSON.stringify(event))});
  function wrapStart(manager: any, kind: 'capture'|'recording'|'youtube') {
    const original = manager.start.bind(manager);
    manager.start = (cameraId: string, ...args: unknown[]) => gate.start(kind,cameraId,()=>original(cameraId,...args));
  }
  function wrapStop(manager: any, kind: 'capture'|'recording'|'youtube') {
    const original = manager.stop.bind(manager);
    manager.stop = (cameraId: string, ...args: unknown[]) => gate.stop(kind,cameraId,()=>original(cameraId,...args));
    manager.stopAll = async () => {
      const active = kind === 'capture' ? manager.list().map((x: any)=>x.cameraId) : kind === 'recording' ? manager.getAllStatuses().map((x: any)=>x.cameraId) : manager.list().map((x: any)=>x.cameraId);
      const results = await Promise.allSettled(active.map((id: string)=>manager.stop(id)));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status==='rejected');
      if(failed.length) throw new AggregateError(failed.map(r=>r.reason),`${kind} stop failed`);
    };
  }
  for(const [manager,kind] of [[captures,'capture'],[recordings,'recording'],[youtube,'youtube']] as const) {wrapStart(manager,kind);wrapStop(manager,kind);}
  return { status: () => gate.status(),
    // API routes historically use a separate coordinatedYoutube facade.
    youtube: {start:(cameraId:string,key:string)=>youtube.start(cameraId,key),stop:async(cameraId:string)=>{await youtube.stop(cameraId);return true;},stopAll:()=>youtube.stopAll(),status:()=>gate.status()}
  };
}
