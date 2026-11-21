import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type StressResult } from "./dashboard-shared";

export interface UsbDiagnostic {
  friendlyName: string;
  instanceId: string;
  locationPaths: string[];
  busHint: string | null;
  status: string;
  vendorId?: string | null;
  productId?: string | null;
  containerId?: string | null;
  serialCandidate?: string | null;
  identityConfidence?: "serial-candidate" | "container-session" | "model-only";
}

export interface UsbBandwidthReport {
  checkedAt: string;
  cameras: Array<{ cameraId: string; cameraName: string; width: number; height: number;
    fps: number; mjpegLowMbps: number; mjpegHighMbps: number; uncompressedYuy2Mbps: number }>;
  totals: { mjpegLowMbps: number; mjpegHighMbps: number; uncompressedYuy2Mbps: number };
  assumptions: { note: string };
}

export function UsbBandwidthPlanner({ requestNode, stressResults, stressBusy }: {
  requestNode: (url: string, options?: RequestInit) => Promise<any>;
  stressResults: StressResult[] | null;
  stressBusy: boolean;
}) {
  const [report, setReport] = useState<UsbBandwidthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = ["Motherboard group A", "Motherboard group B", "PCIe USB card", "Unassigned"];
  const [placements, setPlacements] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("tournament-usb-plan-v1") || "{}"); }
    catch { return {}; }
  });
  function assign(cameraId: string, group: string) {
    setPlacements(previous => {
      const next = { ...previous, [cameraId]: group };
      try { localStorage.setItem("tournament-usb-plan-v1", JSON.stringify(next)); }
      catch { /* browser storage unavailable */ }
      return next;
    });
  }
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await requestNode("/api/usb/bandwidth-estimate")); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="USB bandwidth planning estimates">
    <h2>USB Bandwidth Planner</h2>
    <p>Estimated USB camera-input traffic using saved resolution and frame-rate settings.
      MJPEG compression depends on the scene and camera, so these figures are planning ranges, not measurements.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Estimating..." : "Estimate USB Camera Bandwidth"}
    </button>
    {error && <p role="alert">Bandwidth estimate failed: {error}</p>}
    {report && <div role="status">
      <p>Checked {new Date(report.checkedAt).toLocaleString()}.</p>
      <table><thead><tr><th>Camera</th><th>Configured input</th><th>MJPEG estimate</th><th>YUY2 hypothetical</th><th>Planned group</th></tr></thead>
        <tbody>{report.cameras.map(camera => <tr key={camera.cameraId}>
          <td>{camera.cameraName}</td>
          <td>{camera.width}×{camera.height} @ {camera.fps} fps</td>
          <td>{camera.mjpegLowMbps}–{camera.mjpegHighMbps} Mbps</td>
          <td>{camera.uncompressedYuy2Mbps} Mbps</td>
          <td><select aria-label={`USB group for ${camera.cameraName}`}
            value={groups.includes(placements[camera.cameraId]) ? placements[camera.cameraId] : "Unassigned"}
            onChange={event => assign(camera.cameraId, event.target.value)}>
            {groups.map(group => <option key={group} value={group}>{group}</option>)}
          </select></td>
        </tr>)}</tbody>
        <tfoot><tr><th>Total</th><th>{report.cameras.length} cameras</th>
          <th>{report.totals.mjpegLowMbps}–{report.totals.mjpegHighMbps} Mbps</th>
          <th>{report.totals.uncompressedYuy2Mbps} Mbps</th><th>Manual plan</th></tr></tfoot>
      </table>
      <h3>Planned USB groups</h3>
      <p>These are manual planning labels, not automatically detected USB host controllers.
        Motherboard ports and PCIe card ports may share controllers.</p>
      <table><thead><tr><th>Planned group</th><th>Cameras</th><th>Estimated MJPEG traffic</th><th>Advice</th></tr></thead>
        <tbody>{groups.map(group => {
          const cameras = report.cameras.filter(camera =>
            (groups.includes(placements[camera.cameraId]) ? placements[camera.cameraId] : "Unassigned") === group);
          const low = cameras.reduce((sum, camera) => sum + camera.mjpegLowMbps, 0);
          const high = cameras.reduce((sum, camera) => sum + camera.mjpegHighMbps, 0);
          return <tr key={group}><td>{group}</td><td>{cameras.length}</td>
            <td>{low.toFixed(1)}–{high.toFixed(1)} Mbps</td>
            <td>{group === "Unassigned" ? "Assign cameras to a group" :
              cameras.length >= 4 ? "High camera count: verify topology and stress-test" :
              cameras.length >= 2 ? "Verify topology and stress-test" : "Verify topology"}</td>
          </tr>;
        })}</tbody>
      </table>
      <h3>Latest stress-test results by planned USB group</h3>
      <p>This correlates the latest 30-second recording stress test with your manually assigned USB groups.
        It is a diagnostic association, not proof that USB bandwidth caused a recording problem.
        Group assignments changed after the test may invalidate the comparison.</p>
      {stressBusy && <p role="status">Stress test in progress. Results below are not yet updated.</p>}
      {!stressResults && <p>No completed stress test in this dashboard session. Start recordings on at least
        two cameras and run the 30-second multi-camera test above.</p>}
      {stressResults && <table><thead><tr><th>Planned group</th><th>Tested</th>
        <th>Pass</th><th>Warning</th><th>Failed</th><th>Observed issues</th></tr></thead>
        <tbody>{groups.map(group => {
          const members = stressResults.filter(result =>
            (groups.includes(placements[result.cameraId]) ? placements[result.cameraId] : "Unassigned") === group);
          const failed = members.filter(result => result.status === "failed").length;
          const warnings = members.filter(result => result.status === "warning").length;
          const issues = members.filter(result => result.status !== "pass")
            .map(result => `${result.cameraName}: ${result.status}`);
          return <tr key={group}><td>{group}</td><td>{members.length}</td>
            <td>{members.filter(result => result.status === "pass").length}</td>
            <td>{warnings}</td><td>{failed}</td>
            <td>{issues.length ? issues.join("; ") : members.length ? "No issues detected" : "Not tested"}</td>
          </tr>;
        })}</tbody></table>}
      {stressResults && <p>{stressResults.filter(result => result.status !== "pass").length > 0
        ? "Some cameras reported recording problems. Review camera logs, USB topology, CPU/GPU load, and disk throughput before attributing failures to USB bandwidth."
        : "All sampled cameras passed this test. This does not guarantee reliability over a full tournament."}</p>}
      <p>Start by distributing high-FPS cameras across independently verified controllers.
        Confirm the actual USB tree in Windows Device Manager, then run the multi-camera stress test.
        Estimates exclude USB overhead and are not measured controller utilization.</p>
      <p>{report.assumptions.note}</p>
      <p>Totals assume all listed cameras share one link, which is a worst-case planning assumption.
        They cannot determine whether a particular USB controller will handle the load.
        Verify controller connections in Device Manager and run the multi-camera recording stress test.</p>
    </div>}
  </section>;
}

export interface CameraMaintenanceSchedule {
  id: string; task: string; intervalDays: number; nextDue: string; lastCompletedAt?: string;
}

export interface CameraAssetRecord {
  label: string; model: string; serial: string; purchasedOn: string; warrantyUntil: string;
  notes: string; maintenance: { id: string; at: string; action: string; notes: string }[];
  schedules?: CameraMaintenanceSchedule[];
}

export function maintenanceDueDate(date: Date, days: number): string {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function maintenanceStatus(due: string, today: string): "Overdue" | "Due today" | "Upcoming" {
  return due < today ? "Overdue" : due === today ? "Due today" : "Upcoming";
}

export function CameraAssetInventory({ nodeId }: { nodeId: string }) {
  const storageKey = `tournament-camera-assets-v1:${nodeId}`;
  const [assets, setAssets] = useState<CameraAssetRecord[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(value) ? value.filter((item): item is CameraAssetRecord =>
        !!item && typeof item.label === "string" && Array.isArray(item.maintenance)).slice(0, 100) : [];
    } catch { return []; }
  });
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const [action, setAction] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [scheduleTask, setScheduleTask] = useState("");
  const [scheduleDays, setScheduleDays] = useState(90);
  const [scheduleDue, setScheduleDue] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const scheduled = assets.flatMap(asset => (asset.schedules || []).map(item => ({ ...item, camera: asset.label })));
  const overdue = scheduled.filter(item => item.nextDue < today).length;
  const dueToday = scheduled.filter(item => item.nextDue === today).length;
  const [message, setMessage] = useState("");
  const current = assets.find(asset => asset.label === selected);
  function persist(next: CameraAssetRecord[]) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setAssets(next); setMessage("Inventory saved in this browser."); }
    catch { setMessage("Could not save inventory. Export a backup before leaving this page."); }
  }
  function update(patch: Partial<CameraAssetRecord>) {
    if (!current) return;
    persist(assets.map(asset => asset.label === selected ? { ...asset, ...patch } : asset));
  }
  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, nodeId, exportedAt: new Date().toISOString(), assets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `camera-equipment-${nodeId}.json`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="overview" aria-label="Camera equipment inventory">
    <h2>Physical Camera Equipment Inventory</h2>
    <p>Track labelled cameras, purchase and warranty dates, and maintenance performed. Records are
      browser-local to this capture node. Use the same labels as confirmed physical camera associations.</p>
    <label>New physical camera label <input value={label} maxLength={80} placeholder="S600-A"
      onChange={e => setLabel(e.target.value)} /></label>{" "}
    <button type="button" onClick={() => {
      const value = label.trim();
      if (!value || assets.some(asset => asset.label.toLowerCase() === value.toLowerCase())) {
        setMessage("Enter a unique nonempty physical camera label."); return;
      }
      if (assets.length >= 100) { setMessage("Inventory limit reached (100 cameras)."); return; }
      persist([...assets, { label: value, model: "", serial: "", purchasedOn: "", warrantyUntil: "", notes: "", maintenance: [] }]);
      setSelected(value); setLabel("");
    }}>Add camera</button>{" "}
    <button type="button" onClick={download} disabled={!assets.length}>Export equipment JSON</button>
    <p role="status">{message}</p>
    <p>{assets.length} physical cameras in this browser inventory.</p>
    <h3>Maintenance reminders</h3>
    <p><strong>{overdue} overdue</strong>, {dueToday} due today, {scheduled.length} scheduled tasks total.
      Reminders appear only when this dashboard is opened; no background notifications are sent.</p>
    {scheduled.length > 0 && <table><thead><tr><th>Camera</th><th>Task</th><th>Next due</th><th>Interval</th><th>Status</th></tr></thead>
      <tbody>{[...scheduled].sort((a,b) => a.nextDue.localeCompare(b.nextDue)).map(item => <tr key={`${item.camera}:${item.id}`}>
        <td>{item.camera}</td><td>{item.task}</td><td>{item.nextDue}</td><td>{item.intervalDays} days</td>
        <td>{maintenanceStatus(item.nextDue, today)}</td></tr>)}</tbody></table>}
    {assets.length > 0 && <><label>Choose camera{" "}<select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">Select a camera</option>
      {assets.map(asset => <option key={asset.label} value={asset.label}>{asset.label}</option>)}
    </select></label></>}
    {current && <div>
      <h3>{current.label}</h3>
      <p><label>Model <input value={current.model} maxLength={120} onChange={e => update({ model: e.target.value })} /></label>{" "}
      <label>Manufacturer serial (verified manually) <input value={current.serial} maxLength={120} onChange={e => update({ serial: e.target.value })} /></label></p>
      <p><label>Purchase date <input type="date" value={current.purchasedOn} onChange={e => update({ purchasedOn: e.target.value })} /></label>{" "}
      <label>Warranty end date <input type="date" value={current.warrantyUntil} onChange={e => update({ warrantyUntil: e.target.value })} /></label></p>
      <label>Equipment notes <textarea value={current.notes} maxLength={2000} rows={2} onChange={e => update({ notes: e.target.value })} /></label>
      {current.warrantyUntil && <p>Warranty end: {current.warrantyUntil}
        {current.warrantyUntil < new Date().toISOString().slice(0, 10) ? " (past date)" : " (upcoming or today)"}.
        Check purchase documentation for actual coverage.</p>}
      <h4>Scheduled maintenance ({(current.schedules || []).length})</h4>
      <p>Schedule recurring checks such as lens cleaning, USB cable inspection, or a recording test.
        Completion logs the task and schedules the next due date from the completion date.</p>
      <label>Task <input value={scheduleTask} maxLength={120} placeholder="Inspect USB cable"
        onChange={e => setScheduleTask(e.target.value)} /></label>{" "}
      <label>Repeat every (days) <input type="number" min={1} max={3650} value={scheduleDays}
        onChange={e => setScheduleDays(Number(e.target.value))} /></label>{" "}
      <label>First due date <input type="date" value={scheduleDue} onChange={e => setScheduleDue(e.target.value)} /></label>{" "}
      <button type="button" onClick={() => {
        const task = scheduleTask.trim();
        if (!task || !Number.isInteger(scheduleDays) || scheduleDays < 1 || scheduleDays > 3650 ||
            (scheduleDue && !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDue))) {
          setMessage("Enter a task, a valid interval of 1 to 3650 days, and an optional due date."); return;
        }
        if ((current.schedules || []).length >= 50) { setMessage("Schedule limit reached (50 per camera)."); return; }
        const entry: CameraMaintenanceSchedule = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          task, intervalDays: scheduleDays, nextDue: scheduleDue || maintenanceDueDate(new Date(), scheduleDays) };
        update({ schedules: [...(current.schedules || []), entry] }); setScheduleTask(""); setScheduleDue("");
      }}>Add recurring task</button>
      {(current.schedules || []).length > 0 && <table><thead><tr><th>Task</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{(current.schedules || []).map(item => <tr key={item.id}>
          <td>{item.task} (every {item.intervalDays} days)</td><td>{item.nextDue}</td>
          <td>{maintenanceStatus(item.nextDue, today)}</td><td>
            <button type="button" onClick={() => {
              if (current.maintenance.length >= 200) { setMessage("Maintenance log full; remove older entries before completing tasks."); return; }
              const now = new Date();
              const entry = { id: `${Date.now()}-${item.id}`, at: now.toISOString(), action: item.task,
                notes: `Scheduled maintenance completed; previous due ${item.nextDue}.` };
              update({ maintenance: [...current.maintenance, entry], schedules: (current.schedules || []).map(sched =>
                sched.id === item.id ? { ...sched, lastCompletedAt: now.toISOString(), nextDue: maintenanceDueDate(now, sched.intervalDays) } : sched) });
            }}>Mark completed</button>{" "}
            <button type="button" onClick={() => {
              if (window.confirm(`Remove scheduled task ${item.task}?`))
                update({ schedules: (current.schedules || []).filter(sched => sched.id !== item.id) });
            }}>Remove</button>
          </td></tr>)}</tbody></table>}
      <h4>Maintenance log ({current.maintenance.length})</h4>
      <label>Action <input value={action} maxLength={120} placeholder="Replaced USB cable" onChange={e => setAction(e.target.value)} /></label>{" "}
      <label>Notes <input value={maintenanceNotes} maxLength={1000} onChange={e => setMaintenanceNotes(e.target.value)} /></label>{" "}
      <button type="button" onClick={() => {
        if (!action.trim()) { setMessage("Enter a maintenance action."); return; }
        if (current.maintenance.length >= 200) { setMessage("Maintenance log limit reached (200 per camera)."); return; }
        const entry = { id: `${Date.now()}-${current.maintenance.length}`, at: new Date().toISOString(), action: action.trim(), notes: maintenanceNotes.trim() };
        update({ maintenance: [...current.maintenance, entry] }); setAction(""); setMaintenanceNotes("");
      }}>Log maintenance</button>
      <ul>{[...current.maintenance].reverse().map(entry => <li key={entry.id}>
        {new Date(entry.at).toLocaleString()}: <strong>{entry.action}</strong> {entry.notes}
        {" "}<button type="button" onClick={() => {
          if (window.confirm("Delete this maintenance entry?")) update({ maintenance: current.maintenance.filter(item => item.id !== entry.id) });
        }}>Remove</button>
      </li>)}</ul>
      <button type="button" onClick={() => {
        if (!window.confirm(`Delete equipment record ${current.label} and its maintenance log?`)) return;
        persist(assets.filter(asset => asset.label !== selected)); setSelected("");
      }}>Delete equipment record</button>
    </div>}
    <p>Equipment labels and serial fields are entered manually. This inventory does not automatically identify
      connected hardware or synchronize across browsers. Export backups before clearing browser data.</p>
  </section>;
}

export interface UsbInventorySnapshot { checkedAt: string; devices: UsbDiagnostic[] }

export function UsbTopologyDiagnostics({ requestNode, nodeId }: { requestNode: (url: string, options?: RequestInit) => Promise<any>; nodeId: string }) {
  const [data, setData] = useState<{ supported: boolean; devices: UsbDiagnostic[]; warning: string | null; checkedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyKey = `tournament-usb-fingerprint-history-v1:${nodeId}`;
  const [history, setHistory] = useState<UsbInventorySnapshot[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((x): x is UsbInventorySnapshot =>
        !!x && typeof x.checkedAt === "string" && Array.isArray(x.devices)).slice(-25) : [];
    } catch { return []; }
  });
  const [historyWarning, setHistoryWarning] = useState("");
  const [previousInventory, setPreviousInventory] = useState<UsbDiagnostic[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("tournament-physical-camera-identities-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch { return {}; }
  });
  const [confirmLabels, setConfirmLabels] = useState<Record<string, string>>({});
  const [confirmCameraIds, setConfirmCameraIds] = useState<Record<string, string>>({});
  const historicalDevices = history.flatMap(snapshot => snapshot.devices.map(device => ({ ...device, observedAt: snapshot.checkedAt })));
  function candidateMatches(device: UsbDiagnostic) {
    return historicalDevices.filter(old => old.instanceId !== device.instanceId &&
      device.vendorId && device.productId && old.vendorId === device.vendorId && old.productId === device.productId &&
      ((device.serialCandidate && old.serialCandidate === device.serialCandidate) ||
       (device.containerId && old.containerId === device.containerId)))
      .filter((item, index, all) => all.findIndex(other => other.instanceId === item.instanceId) === index).slice(0, 8);
  }
  function confirmIdentity(device: UsbDiagnostic) {
    const label = (confirmLabels[device.instanceId] || "").trim().slice(0, 80);
    const cameraId = (confirmCameraIds[device.instanceId] || "").trim();
    if (!label || !cameraId || cameraId.length > 400) {
      setHistoryWarning("Enter a physical label and the exact camera ID from the recording report before confirming."); return;
    }
    const key = `${nodeId}::${cameraId}`;
    const next = { ...confirmed, [key]: label };
    try {
      localStorage.setItem("tournament-physical-camera-identities-v1", JSON.stringify(next));
      setConfirmed(next); setHistoryWarning(`Confirmed ${cameraId} as ${label}. Refresh the report archive to see updated groupings.`);
    } catch { setHistoryWarning("Browser storage is unavailable. Export your data before closing this page."); }
  }
  async function inspect() {
    setBusy(true); setError(null);
    try {
      const next = await requestNode("/api/usb/diagnostics");
      setPreviousInventory(data?.devices || []);
      setData(next);
      if (next.supported && Array.isArray(next.devices) && !next.warning) {
        const updated = [...history, { checkedAt: next.checkedAt, devices: next.devices }].slice(-25);
        try { localStorage.setItem(historyKey, JSON.stringify(updated)); setHistory(updated); }
        catch { setHistoryWarning("USB history could not be saved. Browser storage may be full."); }
      }
    }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="overview" aria-label="USB camera topology diagnostics">
    <h2>USB Camera Topology</h2>
    <p>Inspect Windows camera connection paths to help distribute cameras across USB ports.
      This is an inventory, not a bandwidth measurement or a verified controller map.</p>
    <button type="button" disabled={busy} onClick={() => void inspect()}>
      {busy ? "Inspecting USB devices..." : "Inspect USB Camera Connections"}
    </button>
    {error && <p role="alert">USB inspection failed: {error}</p>}
    {historyWarning && <p role="status">{historyWarning}</p>}
    <p>Saved inventory snapshots for this node: {history.length} (maximum 25, browser-local).</p>
    {history.length > 0 && <div>
      <button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify({ version: 1, nodeId, exportedAt: new Date().toISOString(), snapshots: history }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = `usb-fingerprint-history-${nodeId}.json`; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export saved fingerprint history</button>{" "}
      <button type="button" onClick={() => {
        if (!window.confirm("Clear saved USB inventory history for this capture node?")) return;
        try { localStorage.removeItem(historyKey); setHistory([]); setHistoryWarning(""); }
        catch { setHistoryWarning("Unable to clear USB history."); }
      }}>Clear saved history</button>
    </div>}
    {data && <div role="status">
      <p>Checked {new Date(data.checkedAt).toLocaleString()}. {data.devices.length} USB camera entries.</p>
      {data.warning && <p>{data.warning}</p>}
      {data.devices.map(device => <div key={device.instanceId}>
        <strong>{device.friendlyName || "Unnamed USB camera"}</strong> ({device.status})
        <p>Windows instance: <code>{device.instanceId}</code></p>
        <p>USB vendor/product: {device.vendorId && device.productId
          ? `${device.vendorId}:${device.productId}` : "Unavailable"}</p>
        <p>Windows container ID: <code>{device.containerId || "Unavailable"}</code></p>
        <p>Possible hardware serial: <code>{device.serialCandidate || "Not found"}</code></p>
        <p>Identity evidence: {device.identityConfidence === "serial-candidate"
          ? "Serial-like identifier, operator verification required"
          : device.identityConfidence === "container-session"
            ? "Windows container association, not permanent hardware identity"
            : "Model information only, not unique"}</p>
        {previousInventory.length > 0 && (() => {
          const matches = previousInventory.filter(old => old.instanceId !== device.instanceId &&
            ((device.serialCandidate && old.serialCandidate === device.serialCandidate &&
              old.vendorId === device.vendorId && old.productId === device.productId) ||
              (device.containerId && old.containerId === device.containerId)));
          return matches.length ? <p>Possible previous device entry: {matches.map(m => m.instanceId).join(", ")}.
            Confirm physically before linking identities.</p> : null;
        })()}
        {candidateMatches(device).length > 0 && <p>Saved-history possible matches: {candidateMatches(device).map(m =>
          `${m.instanceId} (${new Date(m.observedAt).toLocaleString()})`).join("; ")}. This is supporting evidence, not proof.</p>}
        <div>
          <label>Physical camera label{" "}<input value={confirmLabels[device.instanceId] || ""}
            placeholder="e.g. S600-A" maxLength={80}
            onChange={e => setConfirmLabels(old => ({ ...old, [device.instanceId]: e.target.value }))} /></label>{" "}
          <label>Exact report camera ID{" "}<input value={confirmCameraIds[device.instanceId] || ""}
            placeholder="Copy from recording report" maxLength={400}
            onChange={e => setConfirmCameraIds(old => ({ ...old, [device.instanceId]: e.target.value }))} /></label>{" "}
          <button type="button" onClick={() => confirmIdentity(device)}>Confirm physical association</button>
          {confirmed[`${nodeId}::${confirmCameraIds[device.instanceId] || ""}`] &&
            <p>Confirmed report identity: {confirmed[`${nodeId}::${confirmCameraIds[device.instanceId]}`]}</p>}
        </div>
        <p>Bus path hint: {device.busHint || "Not available"}</p>
        <p>Location: <code>{device.locationPaths[0] || "Not reported"}</code></p>
      </div>)}
      <p>USB vendor/product IDs identify a model, not an individual camera. Windows container IDs can
        change when devices are reconnected or moved. Serial-like instance suffixes are only candidates,
        not authenticated serial numbers. This view never merges physical camera histories automatically.
        Refresh the inventory after reconnecting a camera to compare entries.</p>
      <button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "usb-camera-hardware-fingerprints.json";
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export USB hardware inventory JSON</button>
      <p>Two devices with the same bus prefix are not necessarily on the same USB controller.
        Use Windows Device Manager (View → Devices by connection) to confirm the physical controller.
        USB utilization and negotiated speed are not measured here.</p>
    </div>}
  </section>;
}
