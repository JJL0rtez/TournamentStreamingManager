import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsbTopology,compareUsbTopologies,discoverUsbTopology } from '../apps/node-service/src/usb-topology.ts';
const sample=(port='2')=>[{instanceId:'USB\\VID_1234&PID_5678\\ABC',friendlyName:'Webcam',className:'Camera',manufacturer:'Example',status:'OK',parentInstanceId:'USB\\ROOT_HUB',locationPaths:[`PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(${port})`],locationInfo:'Port 2',service:'usbvideo'}];
test('Windows PnP path maps to USB root and port',()=>{
 const report=normalizeUsbTopology(sample());
 assert.equal(report.devices[0].physicalPortPath,'USBROOT(0)/USB(2)');
 assert.equal(report.devices[0].mappingConfidence,'location-path');
 assert.equal(report.groups.length,1);
 assert.equal(report.groups[0].videoDevices,1);
 assert.equal(report.groups[0].uniquePortPaths,1);
});
test('no fabricated controller root for devices without location paths',()=>{
 const report=normalizeUsbTopology([{instanceId:'X',friendlyName:'Unknown',parentInstanceId:'Parent'}]);
 assert.equal(report.devices[0].controllerRoot,null);
 assert.equal(report.devices[0].mappingConfidence,'parent-only');
 assert.equal(report.groups[0].key,'Unmapped controller');
});
test('single-object powershell JSON and empty output are supported',()=>{
 assert.equal(normalizeUsbTopology(sample()[0]).devices.length,1);
 assert.equal(normalizeUsbTopology([]).devices.length,0);
});
test('compare tracks moved, added and removed device IDs',()=>{
 const before=normalizeUsbTopology([...sample(),{instanceId:'REMOVED',friendlyName:'Mic'}]);
 const after=normalizeUsbTopology([...sample('3'),{instanceId:'ADDED',friendlyName:'New mic'}]);
 const changes=compareUsbTopologies(before,after);
 assert.equal(changes.find(c=>c.instanceId===sample()[0].instanceId).change,'moved');
 assert.equal(changes.find(c=>c.instanceId==='REMOVED').change,'disconnected');
 assert.equal(changes.find(c=>c.instanceId==='ADDED').change,'connected');
});
test('non-Windows platform reports unsupported rather than inventing devices',async()=>{
 if(process.platform==='win32')return;
 const report=await discoverUsbTopology();
 assert.equal(report.supported,false);
 assert.equal(report.devices.length,0);
});
