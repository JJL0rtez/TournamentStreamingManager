import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CaptureQuality, type DeviceList, type MediaDevice, type SessionAssignment } from "./dashboard-shared";

export interface CameraCapabilityResult {
  cameraName: string;
  detected: boolean;
  requestedFps: number;
  selectedMode: { width: number; height: number; fps: number } | null;
  modes: Array<{ width: number; height: number; fps: number; pixelFormat: string }>;
  error?: string;
}

export function CaptureQualityPanel() {
  const [quality, setQuality] = useState<CaptureQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDevice[]>([]);
  const [qualityAssignments, setQualityAssignments] = useState<SessionAssignment[]>([]);
  const qualityCameraLabel = (camera: MediaDevice) => {
    const ring = qualityAssignments.find(item => item.cameraId === camera.id)?.ring;
    return `${ring || "Unassigned"} (${camera.name})`;
  };
  const [selectedCamera, setSelectedCamera] = useState("");
  const [capabilities, setCapabilities] = useState<CameraCapabilityResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [perCameraQuality, setPerCameraQuality] = useState({
    width: 1920, height: 1080, fps: 30, recordingBitrateMbps: 12, streamingBitrateKbps: 4500
  });
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityNotice, setQualityNotice] = useState("");
  const [bulkPreset, setBulkPreset] = useState("standard-1080p30");
  const [bulkTargets, setBulkTargets] = useState<string[]>([]);
  const [bulkQualityBusy, setBulkQualityBusy] = useState(false);
  const [bulkQualityNotice, setBulkQualityNotice] = useState("");
  const presets = [
    { id: "standard-1080p30", name: "Standard 1080p30 (12 Mbps)" },
    { id: "high-1080p60", name: "High quality 1080p60 (16 Mbps)" },
    { id: "usb-light-720p30", name: "Reduced USB load 720p30 (6 Mbps)" }
  ];
  async function applyBulkPreset() {
    if (!bulkTargets.length) return;
    if (!window.confirm(`Apply ${bulkPreset} to ${bulkTargets.length} selected cameras? Changes take effect on their next recording.`)) return;
    setBulkQualityBusy(true); setError(null); setBulkQualityNotice("");
    try {
      const response = await fetch("/api/camera-quality/apply-preset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: bulkPreset, cameraIds: bulkTargets })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setBulkQualityNotice(`Applied ${bulkPreset} to ${result.updated} cameras. Restart their recordings to use the new settings.`);
      if (selectedCamera && bulkTargets.includes(selectedCamera)) setPerCameraQuality(result.quality);
    } catch (cause) { setError(String(cause)); }
    finally { setBulkQualityBusy(false); }
  }

  useEffect(() => {
    if (!selectedCamera) return;
    let alive = true;
    setQualityNotice("");
    fetch(`/api/camera-quality/${encodeURIComponent(selectedCamera)}`)
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(result => { if (alive) setPerCameraQuality(result.quality); })
      .catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [selectedCamera]);
  async function updateCameraQuality(reset = false) {
    if (!selectedCamera) return;
    setQualityBusy(true); setError(null); setQualityNotice("");
    try {
      const response = await fetch(`/api/camera-quality/${encodeURIComponent(selectedCamera)}`, {
        method: reset ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(reset ? {} : { body: JSON.stringify(perCameraQuality) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setPerCameraQuality(result.quality);
      setQualityNotice(reset ? "Camera override cleared." : "Saved. Applies when this camera next starts recording.");
    } catch (cause) { setError(String(cause)); }
    finally { setQualityBusy(false); }
  }

  useEffect(() => {
    fetch("/api/devices").then(response => response.json()).then((data: DeviceList) => {
      setCameras(data.cameras);
    }).catch(() => {});
    fetch("/api/session").then(response => response.json()).then(data => {
      if (Array.isArray(data.session?.assignments)) setQualityAssignments(data.session.assignments);
    }).catch(() => {});
  }, []);
  async function probeSelectedCamera() {
    if (!selectedCamera) return;
    setProbeBusy(true); setError(null); setCapabilities(null);
    try {
      const response = await fetch(`/api/cameras/${encodeURIComponent(selectedCamera)}/capabilities`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setCapabilities(data as CameraCapabilityResult);
    } catch (cause) { setError(String(cause)); }
    finally { setProbeBusy(false); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/capture-quality").then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<CaptureQuality>;
    }).then(data => { if (active) setQuality(data); })
      .catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  return <section aria-label="Capture quality settings" className="overview">
    <h2>Capture and Streaming Quality</h2>
    {error && <p role="alert">Quality settings unavailable: {error}</p>}
    {quality && <p>Recording input: {quality.inputWidth}×{quality.inputHeight} at {quality.recordingFps} fps,
      target bitrate {quality.recordingBitrate}. YouTube output: {quality.streamingWidth}×{quality.streamingHeight}
      at {quality.streamingFps} fps, target bitrate {quality.streamingBitrate}. Preview: {quality.previewFps} fps.</p>}
    <fieldset disabled={bulkQualityBusy || qualityBusy}>
      <legend>Bulk quality presets</legend>
      <label>Preset <select value={bulkPreset} onChange={event => setBulkPreset(event.target.value)}>
        {presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div><button type="button" onClick={() => setBulkTargets(cameras.map(item => item.id))}>Select all connected</button>
        <button type="button" onClick={() => setBulkTargets([])}>Clear selection</button></div>
      {cameras.map(camera => <label key={camera.id} style={{ display: "block" }}>
        <input type="checkbox" checked={bulkTargets.includes(camera.id)}
          onChange={event => setBulkTargets(previous => event.target.checked ?
            [...previous.filter(id => id !== camera.id), camera.id] : previous.filter(id => id !== camera.id))}/>
        {qualityCameraLabel(camera)}
      </label>)}
      <button type="button" disabled={!bulkTargets.length || bulkQualityBusy}
        onClick={() => void applyBulkPreset()}>
        {bulkQualityBusy ? "Applying..." : `Apply preset to ${bulkTargets.length} camera(s)`}
      </button>
      {bulkQualityNotice && <p role="status">{bulkQualityNotice}</p>}
      <p>Presets apply only to new recordings. 1080p60 requires camera and USB controller support.
        The 720p preset reduces camera input bandwidth; YouTube output remains configured at 1080p30.</p>
    </fieldset>
    <div>
      <label>Camera mode detection: <select value={selectedCamera} onChange={event => {
        setSelectedCamera(event.target.value); setCapabilities(null);
      }}><option value="">Choose camera</option>{cameras.map(camera =>
        <option key={camera.id} value={camera.id}>{qualityCameraLabel(camera)}</option>)}</select></label>
      <button type="button" disabled={!selectedCamera || probeBusy} onClick={() => void probeSelectedCamera()}>
        {probeBusy ? "Detecting..." : "Detect Supported Modes"}</button>
      {selectedCamera && <fieldset disabled={qualityBusy}>
        <legend>Per-camera recording and streaming quality</legend>
        <label>Width <input type="number" min="320" max="3840" step="1"
          value={perCameraQuality.width} onChange={event => setPerCameraQuality(q => ({ ...q, width: Number(event.target.value) }))}/></label>
        <label>Height <input type="number" min="240" max="2160" step="1"
          value={perCameraQuality.height} onChange={event => setPerCameraQuality(q => ({ ...q, height: Number(event.target.value) }))}/></label>
        <label>Capture/record FPS <input type="number" min="1" max="120" step="1"
          value={perCameraQuality.fps} onChange={event => setPerCameraQuality(q => ({ ...q, fps: Number(event.target.value) }))}/></label>
        <label>Recording bitrate (Mbps) <input type="number" min="1" max="100" step="1"
          value={perCameraQuality.recordingBitrateMbps} onChange={event => setPerCameraQuality(q => ({ ...q, recordingBitrateMbps: Number(event.target.value) }))}/></label>
        <label>YouTube bitrate (kbps) <input type="number" min="500" max="20000" step="100"
          value={perCameraQuality.streamingBitrateKbps} onChange={event => setPerCameraQuality(q => ({ ...q, streamingBitrateKbps: Number(event.target.value) }))}/></label>
        <button type="button" onClick={() => void updateCameraQuality()}>Save Camera Quality</button>
        <button type="button" onClick={() => void updateCameraQuality(true)}>Reset to Defaults</button>
        {qualityNotice && <p role="status">{qualityNotice}</p>}
        <p>Streaming stays at 1080p30; resolution and FPS here control the camera input and local recording.
          Confirm the camera supports the selected input mode using Detect Supported Modes.</p>
      </fieldset>}
      {capabilities && <div role="status">
        <p>{capabilities.detected ? `${capabilities.modes.length} MJPEG modes detected.` :
          `Unable to detect modes: ${capabilities.error || "unknown error"}`}</p>
        <p>Selected 1080p mode: {capabilities.selectedMode ?
          `${capabilities.selectedMode.width}×${capabilities.selectedMode.height} @ ${capabilities.selectedMode.fps} fps` :
          "None detected"}</p>
        {capabilities.modes.slice(0, 16).map((mode, index) => <p key={index}>
          {mode.width}×{mode.height} @ {mode.fps} fps ({mode.pixelFormat})</p>)}
      </div>}
    </div>
    <p>60 fps recording is opt-in using TOURNAMENT_CAPTURE_FPS=60 before starting the backend.
      Camera MJPEG mode and USB bandwidth must support 1080p60. These are configured targets,
      not independently verified recording frame rates.</p>
  </section>;
}
