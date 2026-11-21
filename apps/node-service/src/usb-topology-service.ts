import { discoverUsbTopology } from "./usb-topology.js";
import type { UsbTopologyReport } from "./usb-topology.js";
let cached:UsbTopologyReport|null=null;
let fetchedAt=0;
let pending:Promise<UsbTopologyReport>|null=null;
export async function getUsbTopology(force=false):Promise<UsbTopologyReport> {
  if(!force && cached && Date.now()-fetchedAt<30000)return cached;
  if(pending)return pending;
  const job=discoverUsbTopology();
  pending=job;
  try {cached=await job;fetchedAt=Date.now();return cached;}
  finally {if(pending===job)pending=null;}
}

import { compareUsbTopologies } from "./usb-topology.js";
let baseline:UsbTopologyReport|null=null;
export async function establishUsbTopologyBaseline() {
  baseline=await getUsbTopology(true);
  return {baselineCapturedAt:baseline.checkedAt,deviceCount:baseline.devices.length};
}
export async function compareUsbTopologyBaseline() {
  if(!baseline)return {baselinePresent:false,changes:[],warning:"Capture a baseline before comparing physical USB ports."};
  const current=await getUsbTopology(true);
  return {baselinePresent:true,baselineCapturedAt:baseline.checkedAt,currentCapturedAt:current.checkedAt,
    changes:compareUsbTopologies(baseline,current)};
}
