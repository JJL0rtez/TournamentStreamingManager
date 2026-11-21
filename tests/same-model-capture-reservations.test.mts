import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureStartReservations, CaptureStartConflict, captureInputCollision } from '../apps/node-service/src/capture-start-reservations.ts';
const first={cameraId:'ring-1',cameraName:'EMEET SmartCam S600',cameraDeviceId:'@device_pnp_usb#vid_328f&pid_00e6#one',microphoneName:'mic-one'};
const second={cameraId:'ring-2',cameraName:first.cameraName,cameraDeviceId:'@device_pnp_usb#vid_328f&pid_00e6#two',microphoneName:'mic-two'};
test('a second identical-model camera may stream while the first is recording',()=>{
 const reservations=new CaptureStartReservations();
 const release=reservations.reserve('shared',second,[{...first,path:'shared'}]);
 assert.equal(reservations.snapshot().length,1);release();
});
test('distinct same-model cameras may reserve simultaneous starts',()=>{
 const reservations=new CaptureStartReservations();const a=reservations.reserve('shared',first,[]);const b=reservations.reserve('shared',second,[]);
 assert.equal(reservations.snapshot().length,2);a();b();
});
test('duplicate alternative ID, physical identity, logical ID, and microphone still conflict',()=>{
 assert.equal(captureInputCollision(first,{...second,cameraDeviceId:first.cameraDeviceId.toUpperCase()}),'cameraDeviceId');
 assert.equal(captureInputCollision({...first,physicalDeviceId:'same'},{...second,physicalDeviceId:'SAME'}),'physicalDeviceId');
 assert.equal(captureInputCollision(first,{...second,cameraId:first.cameraId}),'cameraId');
 assert.equal(captureInputCollision(first,{...second,microphoneName:first.microphoneName}),'microphoneName');
});
test('ambiguous name-only and synthetic identifiers remain fail-closed',()=>{
 const locks=new CaptureStartReservations();const release=locks.reserve('shared',first,[]);
 assert.throws(()=>locks.reserve('legacy-recording',{...second,cameraDeviceId:undefined},[]),CaptureStartConflict);
 assert.throws(()=>locks.reserve('shared',{...second,cameraDeviceId:'video:EMEET SmartCam S600'},[]),CaptureStartConflict);release();
});
