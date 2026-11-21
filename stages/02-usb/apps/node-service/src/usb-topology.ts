import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync=promisify(execFile);

export type UsbDevice = {
  instanceId:string; friendlyName:string; className:string|null;
  manufacturer:string|null; status:string|null;
  parentInstanceId:string|null; locationPaths:string[];
  locationInfo:string|null; service:string|null;
  controllerRoot:string|null; physicalPortPath:string|null;
  mappingConfidence:"location-path"|"parent-only"|"unavailable";
};
export type UsbControllerGroup = {
  key:string; devices:UsbDevice[]; uniquePortPaths:number;
  videoDevices:number; audioDevices:number;
  warnings:string[];
};
export type UsbTopologyReport = {
  checkedAt:string; platform:string; supported:boolean;
  devices:UsbDevice[]; groups:UsbControllerGroup[];
  warnings:string[]; mappingMethod:string;
};
const script=String.raw`
$ErrorActionPreference='Stop'
$devices=@(Get-PnpDevice -PresentOnly | Where-Object {
  $_.Class -in @('Camera','Image','MEDIA','USB','USBDevice') -or
  $_.InstanceId -like 'USB\*'
})
$result=@(foreach($device in $devices) {
  $props=@{}
  try {
    Get-PnpDeviceProperty -InstanceId $device.InstanceId -ErrorAction Stop |
      ForEach-Object { $props[$_.KeyName]=$_.Data }
  } catch {}
  $paths=@()
  $rawPaths=$props['DEVPKEY_Device_LocationPaths']
  if($null -ne $rawPaths) { $paths=@($rawPaths | ForEach-Object { [string]$_ }) }
  [PSCustomObject]@{
    instanceId=[string]$device.InstanceId
    friendlyName=[string]$device.FriendlyName
    className=[string]$device.Class
    manufacturer=[string]$device.Manufacturer
    status=[string]$device.Status
    parentInstanceId=[string]$props['DEVPKEY_Device_Parent']
    locationPaths=$paths
    locationInfo=[string]$props['DEVPKEY_Device_LocationInfo']
    service=[string]$props['DEVPKEY_Device_Service']
  }
})
ConvertTo-Json -InputObject $result -Depth 6 -Compress
`;
const stringOrNull=(v:unknown):string|null=>typeof v==="string" && v.trim()?v.trim():null;
const usbPath=(v:string):string|null=>{
  // A location path may include a PCI root and multiple USB hub ports.
  // Preserve all USBROOT/USB segments, never claim a controller identity
  // when Windows did not provide one.
  const parts=v.match(/(?:USBROOT|USB)\(\d+\)/gi);
  return parts?.length?parts.join("/"):null;
};
export function normalizeUsbTopology(raw:unknown,platform="win32"):UsbTopologyReport {
  const rows=Array.isArray(raw)?raw:raw && typeof raw==="object"?[raw]:[];
  const devices:UsbDevice[]=rows.filter(v=>v && typeof v==="object").map((v)=>{
    const x=v as Record<string,unknown>;
    const paths=(Array.isArray(x.locationPaths)?x.locationPaths:typeof x.locationPaths==="string"?[x.locationPaths]:[])
      .filter((p):p is string=>typeof p==="string" && p.length>0);
    const port=paths.map(usbPath).find(Boolean)??null;
    const root=paths.map(p=>p.match(/^(.*?)(?=#USBROOT\()/i)?.[1]??null).find(Boolean)??null;
    const parent=stringOrNull(x.parentInstanceId);
    return {
      instanceId:stringOrNull(x.instanceId)??"",friendlyName:stringOrNull(x.friendlyName)??"Unknown device",
      className:stringOrNull(x.className),manufacturer:stringOrNull(x.manufacturer),
      status:stringOrNull(x.status),parentInstanceId:parent,locationPaths:paths,
      locationInfo:stringOrNull(x.locationInfo),service:stringOrNull(x.service),
      controllerRoot:root,physicalPortPath:port,
      mappingConfidence:port?"location-path":parent?"parent-only":"unavailable"
    };
  }).filter(x=>x.instanceId).sort((a,b)=>a.friendlyName.localeCompare(b.friendlyName));
  const grouped=new Map<string,UsbDevice[]>();
  for(const dev of devices) {
    const key=dev.controllerRoot??"Unmapped controller";
    grouped.set(key,[...(grouped.get(key)??[]),dev]);
  }
  const groups=[...grouped].map(([key,items])=>{
    const ports=new Set(items.map(x=>x.physicalPortPath).filter(Boolean));
    const warnings:string[]=[];
    if(key==="Unmapped controller")warnings.push("Windows did not expose a reliable controller root for these devices.");
    const video=items.filter(x=>/^(camera|image)$/i.test(x.className??"")).length;
    const audio=items.filter(x=>/^media$/i.test(x.className??"")).length;
    return {key,devices:items,uniquePortPaths:ports.size,videoDevices:video,audioDevices:audio,warnings};
  });
  return {
    checkedAt:new Date().toISOString(),platform,supported:platform==="win32",devices,groups,
    warnings:[
      "USB location paths identify Windows-reported topology, not guaranteed available bandwidth.",
      "Composite camera and microphone interfaces may appear as separate devices.",
      "USB-over-Ethernet extenders may expose a shared upstream link; validate using simultaneous capture.",
      ...(devices.some(x=>x.mappingConfidence!=="location-path")?["Some devices have incomplete physical-port mapping."]:[])
    ],
    mappingMethod:"Windows PnP DEVPKEY_Device_LocationPaths, parent and class; no invented bandwidth measurements"
  };
}
export async function discoverUsbTopology():Promise<UsbTopologyReport> {
  if(process.platform!=="win32")return normalizeUsbTopology([],process.platform);
  const {stdout}=await execFileAsync("powershell.exe",
    ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script],
    {timeout:25000,maxBuffer:8*1024*1024,windowsHide:true});
  const raw=JSON.parse(stdout.trim()||"[]") as unknown;
  return normalizeUsbTopology(raw,process.platform);
}

export interface UsbTopologyChange {
  instanceId:string;
  friendlyName:string;
  change:"connected"|"disconnected"|"moved"|"unchanged";
  beforePort:string|null;
  afterPort:string|null;
}
/** Compare two snapshots without confusing camera name with persistent instance ID. */
export function compareUsbTopologies(before:UsbTopologyReport,after:UsbTopologyReport):UsbTopologyChange[] {
  const previous=new Map(before.devices.map(device=>[device.instanceId,device]));
  const current=new Map(after.devices.map(device=>[device.instanceId,device]));
  const changes:UsbTopologyChange[]=[];
  for(const [id,old] of previous) {
    const next=current.get(id);
    changes.push({instanceId:id,friendlyName:next?.friendlyName??old.friendlyName,
      change:!next?"disconnected":old.physicalPortPath!==next.physicalPortPath || old.controllerRoot!==next.controllerRoot?"moved":"unchanged",
      beforePort:old.physicalPortPath,afterPort:next?.physicalPortPath??null});
  }
  for(const [id,device] of current)if(!previous.has(id))
    changes.push({instanceId:id,friendlyName:device.friendlyName,change:"connected",beforePort:null,afterPort:device.physicalPortPath});
  return changes.sort((a,b)=>a.friendlyName.localeCompare(b.friendlyName));
}
