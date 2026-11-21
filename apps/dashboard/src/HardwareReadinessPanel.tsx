import { useEffect, useState } from "react";

type RequestNode = (url: string, options?: RequestInit) => Promise<any>;
type Plan = { cameras: number; recordingMbpsPerCamera: number; streamMbpsPerCamera: number; hours: number; safetyFactor: number };
type StorageResult = {
  plan: Plan & { estimatedBytes: number; reservedBytes: number; writeMiBps: number;
    recommendedWriteMiBps: number; uploadMbps: number; recommendedUploadMbps: number;
    capacityEnough: boolean | null; throughputEnough: boolean | null; freeBytes: number | null;
    measuredWriteMiBps: number | null };
  warnings: string[]; directory: string; benchmarkRunning: boolean;
};
type UsbDevice = { instanceId: string; friendlyName: string; className: string | null;
  controllerRoot: string | null; physicalPortPath: string | null; mappingConfidence: string };
type UsbReport = { supported: boolean; devices: UsbDevice[]; warnings: string[] };
type UsbChange = { instanceId: string; type: string; [key: string]: unknown };

const formatSize = (bytes: number | null) => bytes === null ? "Unknown" : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

export function HardwareReadinessPanel({ requestNode, local }: { requestNode: RequestNode; local: boolean }) {
  const [plan, setPlan] = useState<Plan>({ cameras: 8, recordingMbpsPerCamera: 8,
    streamMbpsPerCamera: 6, hours: 10, safetyFactor: 1.5 });
  const [storage, setStorage] = useState<StorageResult | null>(null);
  const [usb, setUsb] = useState<UsbReport | null>(null);
  const [changes, setChanges] = useState<{ baselinePresent: boolean; changes: UsbChange[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [location, setLocation] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [directoryChoices, setDirectoryChoices] = useState<string[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [drives, setDrives] = useState<string[]>([]);

  async function refreshStorage() {
    const q = new URLSearchParams(Object.entries(plan).map(([k, v]) => [k, String(v)]));
    setStorage(await requestNode(`/api/storage/readiness?${q}`) as StorageResult);
  }
  async function refreshUsb() {
    const report = await requestNode("/api/usb/topology?refresh=1") as UsbReport;
    setUsb(report);
    setChanges(await requestNode("/api/usb/topology/changes"));
  }
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setInfo("");
    try { await run(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void requestNode("/api/storage/readiness").then((v: StorageResult) => { if (active) setStorage(v); }).catch(() => {});
    if (local) void requestNode("/api/storage/drives").then((v: {drives: string[]}) => {if (active) setDrives(v.drives);}).catch(() => {});
    void requestNode("/api/storage/location").then((v: {directory: string}) => {
      if (active) {setLocation(v.directory); setBrowsePath(v.directory);}
    }).catch(() => {});
    void requestNode("/api/usb/topology").then((v: UsbReport) => { if (active) setUsb(v); }).catch(() => {});
    return () => { active = false; };
  }, [requestNode]);
  async function browse(directory: string) {
    const result = await requestNode(`/api/storage/directories?path=${encodeURIComponent(directory)}`) as {path: string; folders: string[]};
    setBrowsePath(result.path); setDirectoryChoices(result.folders); setBrowseOpen(true);
  }
  async function saveLocation() {
    if (!window.confirm("Change the recording folder for new recordings? Existing files will not be moved. Stop all recordings and streams first.")) return;
    const result = await requestNode("/api/storage/location", {method: "PUT", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({directory: location})}) as {directory: string};
    setLocation(result.directory); setBrowsePath(result.directory); setBrowseOpen(false);
    await refreshStorage(); setInfo("Recording folder updated. Existing files were not moved.");
  }
  function field(key: keyof Plan, label: string, min: number, max: number, step: number) {
    return <label key={key}><span>{label}</span><input type="number" min={min} max={max} step={step}
      value={plan[key]} onChange={e => setPlan(old => ({ ...old, [key]: Number(e.target.value) }))} /></label>;
  }
  return <section className="session-panel" aria-label="Hardware readiness">
    <h3>Hardware Readiness</h3>
    <p className="muted">Plan recording capacity and verify USB connections before the event. Benchmarks should not run during a tournament.</p>
    <div className="hardware-readiness-grid">
      <div className="hardware-readiness-card">
        <h4>Recording drive</h4>
        <div className="recording-location-row">
          <label className="field"><span>Save recordings to</span>
            <input type="text" value={location} disabled={!local || busy}
              onChange={event => setLocation(event.target.value)} placeholder="Choose a folder on this PC" />
          </label>
          <div className="hardware-actions">
          {local && <button type="button" disabled={busy} onClick={() => void action(() => browse(location || browsePath))}>Browse folders</button>}
          {local && <button type="button" className="primary-button" disabled={busy || !location.trim() || location === storage?.directory}
            onClick={() => void action(saveLocation)}>Save location</button>}
          </div>
        </div>
        {browseOpen && <div className="recording-folder-browser">
          <p><strong>Current folder:</strong> {browsePath}</p>
          <div className="hardware-actions">
            {drives.length > 0 && <label>Drive <select value="" onChange={event => {if (event.target.value) void action(() => browse(event.target.value));}}>
              <option value="">Choose drive</option>{drives.map(drive => <option key={drive} value={drive}>{drive}</option>)}
            </select></label>}
            <button type="button" onClick={() => {setLocation(browsePath); setBrowseOpen(false);}}>Select this folder</button>
            <button type="button" onClick={() => void action(() => browse(browsePath.replace(/[\\/][^\\/]+[\\/]?$/, "") || browsePath))}>Up one folder</button>
            <button type="button" onClick={() => setBrowseOpen(false)}>Close</button>
          </div>
          <div className="recording-folder-choices">{directoryChoices.map(name =>
            <button type="button" key={name} onClick={() => void action(() => browse(`${browsePath.replace(/[\\/]$/, "")}${browsePath.includes("\\") ? "\\" : "/"}${name}`))}>{name}</button>)}</div>
        </div>}
        <div className="hardware-planning">
          <h5>Capacity and write-speed</h5>
          {storage && <div className="hardware-stat-grid">
            <div className="hardware-stat"><small>Disk free</small><strong>{formatSize(storage.plan.freeBytes)}</strong></div>
            <div className="hardware-stat"><small>Required write</small><strong>{storage.plan.recommendedWriteMiBps.toFixed(1)} MiB/s</strong></div>
            <div className="hardware-stat"><small>Measured write</small><strong>{storage.plan.measuredWriteMiBps === null ? "Not tested" : `${storage.plan.measuredWriteMiBps.toFixed(1)} MiB/s`}</strong></div>
            <div className="hardware-stat"><small>With margin</small><strong>{formatSize(storage.plan.reservedBytes)}</strong></div>
          </div>}
          <details className="planning-parameters"><summary>Adjust planning assumptions</summary>
        <div className="hardware-readiness-fields">
          {field("cameras", "Cameras", 1, 128, 1)}
          {field("recordingMbpsPerCamera", "Record bitrate (Mbps/camera)", 0.1, 250, 0.5)}
          {field("streamMbpsPerCamera", "Stream bitrate (Mbps/camera)", 0, 100, 0.5)}
          {field("hours", "Event duration (hours)", 0.1, 72, 0.5)}
          {field("safetyFactor", "Storage safety factor", 1, 4, 0.1)}
        </div>
          </details>
        <div className="hardware-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => void action(refreshStorage)}>Recalculate</button>
          {local && <button type="button" disabled={busy} onClick={() => void action(async () => {
            if (!window.confirm("Run a 64 MiB temporary-file disk benchmark? Do not run during a live tournament.")) return;
            await requestNode("/api/storage/benchmark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sampleMiB: 64 }) });
            await refreshStorage(); setInfo("Disk benchmark complete.");
          })}>Test write speed (64 MiB)</button>}
        </div>
        {storage && <>
          <p className="muted" style={{ marginTop: 12 }}>Recording location: <code>{storage.directory}</code></p>
          <p role="status">Capacity: {storage.plan.capacityEnough === null ? "Unknown" : storage.plan.capacityEnough ? "Pass" : "Insufficient"} · Write speed: {storage.plan.throughputEnough === null ? "Not verified" : storage.plan.throughputEnough ? "Pass" : "Below target"}</p>
          {storage.warnings.map((w, i) => <p role="alert" key={i}>{w}</p>)}
        </>}
        </div>
      </div>
      <div className="hardware-readiness-card">
        <h4>USB port topology</h4>
        <p className="muted">Identify which physical USB ports and controllers your cameras use. Save a baseline after wiring the cameras.</p>
        <div className="hardware-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => void action(refreshUsb)}>Scan connected USB devices</button>
          {local && <button type="button" disabled={busy} onClick={() => void action(async () => {
            await requestNode("/api/usb/topology/baseline", { method: "POST" });
            await refreshUsb(); setInfo("USB baseline saved.");
          })}>Save current USB baseline</button>}
        </div>
        {usb && <>
          <p style={{ marginTop: 12 }}>{usb.supported ? `${usb.devices.length} Windows PnP devices found` : "Physical USB mapping is available on Windows only."}</p>
          {usb.devices.length > 0 && <div className="hardware-usb-table"><table>
            <thead><tr><th>Device</th><th>Class</th><th>Controller</th><th>Physical port</th></tr></thead>
            <tbody>{usb.devices.map(d => <tr key={d.instanceId}><td title={d.instanceId}>{d.friendlyName}</td>
              <td>{d.className ?? "Unknown"}</td><td>{d.controllerRoot ?? "Not mapped"}</td>
              <td>{d.physicalPortPath ?? "Unavailable"}</td></tr>)}</tbody>
          </table></div>}
          {usb.warnings.map((w, i) => <p className="muted" key={i}>{w}</p>)}
        </>}
        {changes && <p role="status">Baseline: {changes.baselinePresent ? "Saved" : "Not saved"} · Changes: {changes.changes.length}</p>}
        {changes?.changes.map((c, i) => <p key={i}>{c.type}: {c.instanceId}</p>)}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    {info && <p role="status">{info}</p>}
  </section>;
}
