import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureStartConflict, CaptureStartReservations, captureInputCollision, type ActiveCaptureIdentity } from '../apps/node-service/src/capture-start-reservations.ts';
const active = (cameraId: string, cameraName: string, cameraDeviceId?: string): ActiveCaptureIdentity => ({ path:'shared', cameraId, cameraName, cameraDeviceId });
test('DirectShow aliases collide even when camera IDs differ', () => {
  assert.equal(captureInputCollision(active('a','Front','video=EMEET S600'),active('b','Back','emeet s600')),'cameraDeviceId');
});
test('microphone aliases collide', () => {
  assert.equal(captureInputCollision({cameraId:'a',cameraName:'A',microphoneName:'audio=Mic A'}, {cameraId:'b',cameraName:'B',microphoneName:'mic a'}),'microphoneName');
});
test('PnP instance IDs distinguish matching friendly names when names differ', () => {
  assert.equal(captureInputCollision({cameraId:'a',cameraName:'A',physicalDeviceId:'USB\\VID_1234\\A'}, {cameraId:'b',cameraName:'B',physicalDeviceId:'usb\\vid_1234\\a'}),'physicalDeviceId');
  assert.equal(captureInputCollision({cameraId:'a',cameraName:'A',physicalDeviceId:'USB\\A'}, {cameraId:'b',cameraName:'B',physicalDeviceId:'USB\\B'}),null);
});
test('batch reservation is atomic and rolls back on conflicts', () => {
  const reservations = new CaptureStartReservations();
  assert.throws(() => reservations.reserveBatch('shared',[{cameraId:'one',cameraName:'One'}, {cameraId:'two',cameraName:'Two'}],[active('two','Other')]),CaptureStartConflict);
  assert.equal(reservations.snapshot().length,0);
  const release = reservations.reserveBatch('shared',[{cameraId:'one',cameraName:'One'}, {cameraId:'three',cameraName:'Three'}],[]);
  assert.equal(reservations.snapshot().length,2);
  release(); release();
  assert.equal(reservations.snapshot().length,0);
});
test('pending camera is protected across async startup', async () => {
  const reservations = new CaptureStartReservations();
  const release = reservations.reserve('shared',{cameraId:'a',cameraName:'A',cameraDeviceId:'video=CAM'},[]);
  await Promise.resolve();
  assert.throws(() => reservations.reserve('legacy-recording',{cameraId:'b',cameraName:'B',cameraDeviceId:'CAM'},[]),CaptureStartConflict);
  release();
  const second = reservations.reserve('legacy-recording',{cameraId:'b',cameraName:'B',cameraDeviceId:'CAM'},[]);
  second();
});
test('replacement cannot race a pending operation', () => {
  const reservations = new CaptureStartReservations();
  const existing = active('a','Camera A','CAM A');
  const release = reservations.reserveReplacement(existing,[existing]);
  assert.throws(() => reservations.reserveReplacement(existing,[existing]),CaptureStartConflict);
  release();
});
test('missing replacement owner fails closed', () => {
  const reservations = new CaptureStartReservations();
  assert.throws(() => reservations.reserveReplacement({cameraId:'a',cameraName:'A'},[]),CaptureStartConflict);
});
