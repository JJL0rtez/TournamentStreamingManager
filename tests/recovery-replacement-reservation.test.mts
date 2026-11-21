import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureStartReservations, CaptureStartConflict } from '../apps/node-service/src/capture-start-reservations.ts';
const current = {path:'shared' as const,cameraId:'ring-1',cameraName:'EMEET SmartCam',cameraDeviceId:'usb-a',microphoneName:'mic-a'};
test('restart reserves its own input and blocks a simultaneous start', () => {
  const locks=new CaptureStartReservations();
  const release=locks.reserveReplacement(current,[current]);
  assert.throws(()=>locks.reserve('legacy-recording',{cameraId:'other',cameraName:'EMEET SmartCam'},[]),CaptureStartConflict);
  release();
  const again=locks.reserve('legacy-recording',{cameraId:'other',cameraName:'EMEET SmartCam'},[]);
  again();
});
test('restart refuses another active capture sharing physical input', () => {
  const locks=new CaptureStartReservations();
  const other={...current,path:'legacy-recording' as const,cameraId:'ring-2'};
  assert.throws(()=>locks.reserveReplacement(current,[current,other]),CaptureStartConflict);
});
test('restart cannot bypass an already pending start', () => {
  const locks=new CaptureStartReservations();
  const pending=locks.reserve('legacy-recording',{cameraId:'new',cameraName:'EMEET SmartCam'},[]);
  assert.throws(()=>locks.reserveReplacement(current,[current]),CaptureStartConflict);
  pending();
});
test('restart requires a matching running shared owner', () => {
  const locks=new CaptureStartReservations();
  assert.throws(()=>locks.reserveReplacement(current,[]),CaptureStartConflict);
});
test('release is idempotent', () => {
  const locks=new CaptureStartReservations();
  const release=locks.reserveReplacement(current,[current]);
  release(); release();
  assert.equal(locks.snapshot().length,0);
});
