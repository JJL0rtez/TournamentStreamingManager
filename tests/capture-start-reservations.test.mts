import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CaptureStartReservations, CaptureStartConflict } from '../apps/node-service/src/capture-start-reservations.ts';
const a = { cameraId: 'ring-1', cameraName: 'EMEET S600', cameraDeviceId: 'usb#1', microphoneName: 'mic#1' };
test('reserves synchronously across recording implementations', () => {
 const lock = new CaptureStartReservations(); const release = lock.reserve('shared', a, []);
 assert.throws(() => lock.reserve('legacy-recording', { ...a, cameraId:'alias' }, []), CaptureStartConflict);
 release(); assert.doesNotThrow(() => lock.reserve('legacy-recording', a, [])());
});
test('blocks physical device aliases and microphone reuse', () => {
 const lock = new CaptureStartReservations(); const release = lock.reserve('shared', a, []);
 assert.throws(() => lock.reserve('legacy-recording', {cameraId:'two',cameraName:'EMEET S600'}, []), CaptureStartConflict);
 assert.throws(() => lock.reserve('legacy-recording', {cameraId:'two',cameraName:'other',microphoneName:'MIC#1'}, []), CaptureStartConflict);
 release();
});
test('blocks collisions with running sessions and allows independent inputs', () => {
 const lock = new CaptureStartReservations();
 const active = [{...a,path:'legacy-recording' as const}];
 assert.throws(() => lock.reserve('shared', {cameraId:'alias',cameraName:'emeet s600'}, active), CaptureStartConflict);
 const release = lock.reserve('shared', {cameraId:'ring-2',cameraName:'Other',microphoneName:'mic#2'}, active);
 assert.equal(lock.snapshot().length,1); release(); assert.equal(lock.snapshot().length,0);
});
test('release is idempotent after failure', () => { const lock = new CaptureStartReservations(); const release=lock.reserve('shared',a,[]); release(); release(); assert.equal(lock.snapshot().length,0); });
