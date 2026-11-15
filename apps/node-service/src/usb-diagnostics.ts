import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface UsbDeviceDiagnostic {
  friendlyName: string;
  instanceId: string;
  locationPaths: string[];
  busHint: string | null;
  status: string;
}

// Read-only Windows PnP inventory. Location paths indicate topology but do not
// reliably identify physical sockets, controller capacity, or live bandwidth.
export async function listUsbVideoDevices(): Promise<{ supported: boolean; devices: UsbDeviceDiagnostic[]; warning: string | null }> {
  if (process.platform !== "win32") return { supported: false, devices: [], warning: "USB topology inventory requires Windows." };
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$items = @(Get-PnpDevice -PresentOnly -Class Camera,Image | Where-Object { $_.InstanceId -like 'USB\*' -or $_.InstanceId -like 'USB#*' } | ForEach-Object {
  $paths = @()
  try {
    $prop = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_LocationPaths' -ErrorAction Stop
    if ($null -ne $prop.Data) { $paths = @($prop.Data) }
  } catch { }
  [pscustomobject]@{
    friendlyName = [string]$_.FriendlyName
    instanceId = [string]$_.InstanceId
    locationPaths = @($paths | ForEach-Object { [string]$_ })
    status = [string]$_.Status
  }
})
ConvertTo-Json -InputObject $items -Depth 5 -Compress
`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 12000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    const raw: unknown = JSON.parse(stdout.trim());
    if (!Array.isArray(raw)) throw new Error("Unexpected PnP inventory format");
    const devices = raw.slice(0, 64).map((item: any): UsbDeviceDiagnostic => {
      const paths = Array.isArray(item.locationPaths) ? item.locationPaths.filter((x: unknown): x is string => typeof x === "string") : [];
      // A common PCIROOT/PCI prefix is a hint, NOT proof of a shared USB controller.
      const first = paths[0] ?? "";
      const match = first.match(/^(PCIROOT\([^)]*\)(?:#PCI\([^)]*\))?)/i);
      return { friendlyName: String(item.friendlyName ?? ""), instanceId: String(item.instanceId ?? ""),
        locationPaths: paths, busHint: match?.[1] ?? null, status: String(item.status ?? "Unknown") };
    });
    return { supported: true, devices, warning: devices.length === 0 ? "No USB camera PnP entries found. Device names may appear under a different Windows class." : null };
  } catch (error) {
    return { supported: true, devices: [], warning: `Windows PnP inventory unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
