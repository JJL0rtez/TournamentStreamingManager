import { saveOverlayImage, getOverlayImage } from "./overlay-assets.js";
import { summarizeCameraReliability } from "./camera-reliability-summary.js";
import { readDiagnosticThresholds, saveDiagnosticThresholds } from "./diagnostic-thresholds.js";
import { investigateRecordingFailures } from "./failure-investigation.js";
import { analyzeResourceFailureCorrelation } from "./resource-failure-correlation.js";
import { getResourceHistory, sampleRecordingResources, resourceSamplingStatus } from "./resource-history.js";
import { analyzeUsbRecordingCorrelation } from "./usb-recording-correlation.js";
import { readUsbThresholds, saveUsbThresholds, getUsbReliabilityWarnings } from "./usb-reliability-warnings.js";
import { appendCameraHealthSnapshot, readCameraHealthHistory, analyzeCameraDisconnections } from "./camera-health-history.js";
import { readReliabilitySettings, changeReliabilitySettings, validateThresholds } from "./reliability-monitor.js";
import { readSystemResources } from "./system-resources.js";
import { estimateUsbBandwidth } from "./usb-bandwidth-estimate.js";
import { listUsbVideoDevices } from "./usb-diagnostics.js";
import { getCameraQuality, listCameraQualityOverrides, saveCameraQuality, deleteCameraQuality, saveCameraQualityBulk } from "./camera-quality-settings.js";
import { probeCameraCapabilities, selectCameraMode } from "./camera-capabilities.js";
import { testMicrophoneLevel } from "./device-test.js";
import { listTournamentTemplates, getTournamentTemplate, saveTournamentTemplate } from "./tournament-session.js";
import { validateRecordingSegments } from "./recording-validation.js";
import { getRecordingHistory, inspectRecordingSegments } from "./recording-history.js";
import { recentRecordingEvents } from "./recording-events.js";
import { installOperatorAuth, requireOperator } from "./operator-auth.js";
import { listYouTubeProfiles, getYouTubeKey, saveYouTubeProfile, deleteYouTubeProfile, importYouTubeProfiles } from "./youtube-profiles.js";
import { getSettings, saveSettings, exportBackup, getNetworkBindAddress } from "./persistent-settings.js";
import { getSession, setSession, recordingDirectory, listTournamentEvents, selectTournamentEvent } from "./tournament-session.js";

import express from "express";
import path from "node:path";
import { mkdir, statfs } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverDevices } from "./device-discovery.js";
import { RecordingManager } from "./recording-manager.js";

import { PreviewStream } from "./preview-stream.js";

import { capturePreviewFrame } from "./preview-capture.js";

import { CameraCapture } from "./camera-capture.js";

import { CameraCaptureManager } from "./camera-capture-manager.js";
import { getCaptureQualitySettings } from "./camera-capture.js";

import { PreviewSessionManager } from "./PreviewSessionManager.js";
import { PreviewProcessManager } from "./PreviewProcessManager.js";
import { YouTubeStreamManager } from "./YouTubeStreamManager.js";
import { streamPort } from "./stream-port.js";
import { installRemoteNodeRoutes } from "./remote-nodes.js";



const previewStream = new PreviewStream();

const sharedCapture = new CameraCapture();

const cameraCaptureManager = new CameraCaptureManager();

let sharedCaptureCamera: string | null = null;
let sharedCaptureMicrophone: string | null = null;
let sharedCaptureRecordingPath: string | null = null;

let sharedCaptureStarting = false;

let sharedCaptureStopping = false;

const app = express();
app.use(express.json({ limit: "8mb" }));
installOperatorAuth(app);
// Protect remote proxy writes too. Node token alone must not grant browser write privileges.
app.use("/api", requireOperator);
installRemoteNodeRoutes(app);
// Overlay images are stored locally per node. Copy/import the image to each node that needs it.
app.post("/api/overlays/images", (req, res) => {
  try { res.json({ imageId: saveOverlayImage(req.body?.base64) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/overlays/images/:imageId", (req, res) => {
  try {
    const imageId = String(req.params.imageId);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type(imageId.endsWith(".png") ? "png" : "jpeg").send(getOverlayImage(imageId));
  } catch { res.status(404).json({ error: "Overlay image not found on this node" }); }
});


const recordingManager = new RecordingManager();
// Recorded sessions remain visible after a backend restart.
app.get("/api/recording-history", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const limit = Number(req.query.limit || 50);
    const history = await getRecordingHistory(Number.isFinite(limit) ? limit : 50);
    const active = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    const sessions = await Promise.all(history.map(async item => {
      try { return { ...item, integrity: await inspectRecordingSegments(item.recordingPath, active.has(item.recordingPath)) }; }
      catch (error) { return { ...item, integrity: { status: "unknown", issues: [error instanceof Error ? error.message : String(error)], segments: [] } }; }
    }));
    res.json({ sessions });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/camera-health/reliability-summary", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await summarizeCameraReliability()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Read-only export of recent recording sessions and diagnostics.
// Report paths come from the journal, not client input.
app.get("/api/recording-history/report", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const format = req.query.format;
    if (format !== "csv" && format !== "json") {
      res.status(400).json({ error: "format must be csv or json" }); return;
    }
    const history = await getRecordingHistory(200);
    const active = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    const sessions = await Promise.all(history.map(async item => {
      try {
        return { ...item, active: active.has(item.recordingPath),
          integrity: await inspectRecordingSegments(item.recordingPath, active.has(item.recordingPath)) };
      } catch (error) {
        return { ...item, active: active.has(item.recordingPath), integrity: {
          status: "unknown", segments: [], totalBytes: 0,
          issues: [error instanceof Error ? error.message : String(error)]
        } };
      }
    }));
    const generatedAt = new Date().toISOString();
    const stamp = generatedAt.slice(0, 19).replace(/[:T]/g, "-");
    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tournament-recording-report-${stamp}.json"`);
      res.json({ generatedAt, scope: "most recent 200 sessions", sessions, recentEvents: recentRecordingEvents() });
      return;
    }
    const cell = (value: unknown): string => {
      let content = String(value ?? "");
      // Prevent spreadsheet formula execution on CSV import.
      if (/^\s*[=+@-]/.test(content)) content = "'" + content;
      return '"' + content.replace(/"/g, '""') + '"';
    };
    const columns = ["cameraId", "cameraName", "recordingPath", "startedAt", "endedAt",
      "outcome", "eventId", "eventName", "ring", "active", "integrityStatus", "segmentCount", "totalBytes", "issues", "requestedWidth", "requestedHeight", "requestedFps", "inputWidth", "inputHeight", "inputFps", "inputFormat", "recordingBitrateMbps", "streamingBitrateKbps", "configurationSource"];
    const rows = sessions.map(item => [item.cameraId, item.cameraName, item.recordingPath,
      item.startedAt, item.endedAt ?? "", item.outcome, item.eventId ?? "", item.eventName ?? "", item.ring ?? "", item.active, item.integrity.status,
      item.integrity.segments.length, item.integrity.totalBytes ?? 0,
      item.integrity.issues.join("; "),
      item.captureConfiguration?.requested.width ?? "", item.captureConfiguration?.requested.height ?? "",
      item.captureConfiguration?.requested.fps ?? "", item.captureConfiguration?.actualInput.width ?? "",
      item.captureConfiguration?.actualInput.height ?? "", item.captureConfiguration?.actualInput.fps ?? "",
      item.captureConfiguration?.actualInput.format ?? "", item.captureConfiguration?.requested.recordingBitrateMbps ?? "",
      item.captureConfiguration?.requested.streamingBitrateKbps ?? "", item.captureConfiguration?.source ?? ""]);
    const csv = "\uFEFF" + [columns, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tournament-recording-report-${stamp}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
// Historical grouping uses event/ring snapshots recorded at capture start.
// Older sessions without snapshots are explicitly marked unattributed.
app.get("/api/recording-history/summary", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const entries = await getRecordingHistory(200);
    const active = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    const selected = typeof req.query.eventId === "string" ? req.query.eventId : null;
    const events = [...new Map(entries.filter(e => e.eventId).map(e => [e.eventId!, { eventId: e.eventId!, eventName: e.eventName || "Unnamed event" }])).values()]
      .sort((a, b) => b.eventId.localeCompare(a.eventId));
    const relevant = selected === null ? entries : entries.filter(e => (e.eventId || "") === selected);
    const rows = await Promise.all(relevant.map(async entry => {
      let segmentCount = 0, bytes = 0, warnings = 0;
      try {
        const integrity = await inspectRecordingSegments(entry.recordingPath, active.has(entry.recordingPath));
        segmentCount = integrity.segments.length;
        bytes = integrity.segments.reduce((sum, segment) => sum + segment.bytes, 0);
        warnings = integrity.issues.length;
      } catch { warnings = 1; }
      const start = Date.parse(entry.startedAt);
      const end = entry.endedAt ? Date.parse(entry.endedAt) : active.has(entry.recordingPath) ? Date.now() : NaN;
      const durationSeconds = Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? Math.round((end - start) / 1000) : null;
      return { cameraId: entry.cameraId, cameraName: entry.cameraName, ring: entry.ring ?? null,
        eventId: entry.eventId ?? null, outcome: entry.outcome,
        active: active.has(entry.recordingPath), segmentCount, bytes, warnings, durationSeconds };
    }));
    const byCamera = new Map<string, {
      cameraId: string; cameraName: string; ring: string | null; sessions: number;
      active: number; failures: number; warnings: number; segments: number;
      bytes: number; knownDurationSeconds: number; unknownDurationSessions: number;
    }>();
    for (const row of rows) {
      const key = JSON.stringify([row.eventId, row.ring, row.cameraId]);
      const item = byCamera.get(key) ?? { cameraId: row.cameraId, cameraName: row.cameraName,
        ring: row.ring, sessions: 0, active: 0, failures: 0, warnings: 0,
        segments: 0, bytes: 0, knownDurationSeconds: 0, unknownDurationSessions: 0 };
      item.sessions++;
      item.active += Number(row.active);
      item.failures += Number(row.outcome === "failed");
      item.warnings += row.warnings;
      item.segments += row.segmentCount;
      item.bytes += row.bytes;
      if (row.durationSeconds === null) item.unknownDurationSessions++;
      else item.knownDurationSeconds += row.durationSeconds;
      byCamera.set(key, item);
    }
    const cameras = [...byCamera.values()].sort((a, b) => (a.ring ?? a.cameraName).localeCompare(b.ring ?? b.cameraName));
    res.json({ generatedAt: new Date().toISOString(), scannedSessions: relevant.length,
      truncated: entries.length === 200, ringLabelsAreCurrent: false, events, selectedEventId: selected, cameras,
      unattributedSessions: relevant.filter(e => !e.eventId).length,
      totals: cameras.reduce((acc, c) => ({ sessions: acc.sessions + c.sessions,
        active: acc.active + c.active, failures: acc.failures + c.failures,
        warnings: acc.warnings + c.warnings, segments: acc.segments + c.segments,
        bytes: acc.bytes + c.bytes, knownDurationSeconds: acc.knownDurationSeconds + c.knownDurationSeconds,
        unknownDurationSessions: acc.unknownDurationSessions + c.unknownDurationSessions }),
        { sessions: 0, active: 0, failures: 0, warnings: 0, segments: 0, bytes: 0,
          knownDurationSeconds: 0, unknownDurationSessions: 0 }) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
// Group recording outcomes by immutable recording-start configuration, not current settings.
// Active and legacy sessions are reported separately so denominators remain meaningful.
app.get("/api/recording-history/configuration-reliability", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const entries = await getRecordingHistory(200);
    const eventId = typeof req.query.eventId === "string" ? req.query.eventId : null;
    const relevant = eventId === null ? entries : entries.filter(entry => entry.eventId === eventId);
    const activePaths = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    type Row = { key: string; width: number; height: number; fps: number;
      inputWidth: number; inputHeight: number; inputFps: number; inputFormat: string;
      recordingBitrateMbps: number; streamingBitrateKbps: number;
      sessions: number; completed: number; failed: number; stopped: number;
      active: number; unfinished: number; failureRatePercent: number | null };
    const groups = new Map<string, Row>();
    let unknownConfiguration = 0;
    for (const entry of relevant) {
      const cfg = entry.captureConfiguration;
      if (!cfg || cfg.source !== "recording-start" || !cfg.requested || !cfg.actualInput) {
        unknownConfiguration++; continue;
      }
      const { requested: q, actualInput: input } = cfg;
      const values = [q.width, q.height, q.fps, q.recordingBitrateMbps,
        q.streamingBitrateKbps, input.width, input.height, input.fps];
      if (values.some(v => !Number.isFinite(v) || v <= 0) || typeof input.format !== "string") {
        unknownConfiguration++; continue;
      }
      const key = JSON.stringify([q.width, q.height, q.fps, q.recordingBitrateMbps,
        q.streamingBitrateKbps, input.width, input.height, input.fps, input.format]);
      const row = groups.get(key) ?? { key, width: q.width, height: q.height, fps: q.fps,
        recordingBitrateMbps: q.recordingBitrateMbps, streamingBitrateKbps: q.streamingBitrateKbps,
        inputWidth: input.width, inputHeight: input.height, inputFps: input.fps, inputFormat: input.format,
        sessions: 0, completed: 0, failed: 0, stopped: 0, active: 0, unfinished: 0, failureRatePercent: null };
      row.sessions++;
      if (activePaths.has(entry.recordingPath)) row.active++;
      else if (entry.outcome === "failed") { row.failed++; row.completed++; }
      else if (entry.outcome === "stopped") { row.stopped++; row.completed++; }
      else row.unfinished++; // Crash/restart may leave a 'started' journal entry.
      groups.set(key, row);
    }
    const configurations = [...groups.values()].map(row => ({ ...row,
      failureRatePercent: row.completed ? Number((100 * row.failed / row.completed).toFixed(2)) : null
    })).sort((a, b) => b.completed - a.completed || a.key.localeCompare(b.key));
    res.json({ generatedAt: new Date().toISOString(), eventId, scannedSessions: relevant.length,
      historyLimit: 200, truncated: entries.length === 200, unknownConfiguration,
      configurations, note: "Failure rate = failed / (failed + stopped) for completed journal sessions only. Active and unfinished sessions are excluded. Requested and selected input modes are not independently measured frame rates. No causal inference is implied." });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
// Drill down by camera and immutable recording-start configuration. Camera IDs are
// device identifiers, not ring labels, and may change when Windows re-enumerates devices.
app.get("/api/recording-history/camera-configuration-reliability", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const entries = await getRecordingHistory(200);
    const eventId = typeof req.query.eventId === "string" ? req.query.eventId : null;
    const relevant = eventId === null ? entries : entries.filter(entry => entry.eventId === eventId);
    const activePaths = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    type Row = { cameraId: string; cameraName: string; configurationKey: string;
      requested: { width: number; height: number; fps: number; recordingBitrateMbps: number; streamingBitrateKbps: number };
      selectedInput: { width: number; height: number; fps: number; format: string };
      sessions: number; stopped: number; failed: number; active: number; unfinished: number;
      completed: number; failureRatePercent: number | null };
    const groups = new Map<string, Row>();
    let unknownConfiguration = 0;
    for (const entry of relevant) {
      const cfg = entry.captureConfiguration;
      if (!cfg || cfg.source !== "recording-start" || !cfg.requested || !cfg.actualInput) {
        unknownConfiguration++; continue;
      }
      const q = cfg.requested, input = cfg.actualInput;
      if ([q.width, q.height, q.fps, q.recordingBitrateMbps, q.streamingBitrateKbps,
        input.width, input.height, input.fps].some(value => !Number.isFinite(value) || value <= 0) ||
        typeof input.format !== "string" || !input.format.trim()) {
        unknownConfiguration++; continue;
      }
      const configurationKey = JSON.stringify([q.width, q.height, q.fps, q.recordingBitrateMbps,
        q.streamingBitrateKbps, input.width, input.height, input.fps, input.format]);
      const key = JSON.stringify([entry.cameraId, configurationKey]);
      const row = groups.get(key) ?? { cameraId: entry.cameraId, cameraName: entry.cameraName,
        configurationKey, requested: { ...q }, selectedInput: { ...input },
        sessions: 0, stopped: 0, failed: 0, active: 0, unfinished: 0,
        completed: 0, failureRatePercent: null };
      row.sessions++;
      if (activePaths.has(entry.recordingPath)) row.active++;
      else if (entry.outcome === "failed") { row.failed++; row.completed++; }
      else if (entry.outcome === "stopped") { row.stopped++; row.completed++; }
      else row.unfinished++;
      groups.set(key, row);
    }
    const cameras = [...groups.values()].map(row => ({ ...row,
      failureRatePercent: row.completed ? Number((100 * row.failed / row.completed).toFixed(2)) : null
    })).sort((a, b) => a.cameraName.localeCompare(b.cameraName) ||
      b.completed - a.completed || a.configurationKey.localeCompare(b.configurationKey));
    res.json({ generatedAt: new Date().toISOString(), eventId, scannedSessions: relevant.length,
      historyLimit: 200, truncated: entries.length === 200, unknownConfiguration, cameras,
      note: "Failure rate = failed / (failed + stopped) for completed sessions. Active and unfinished sessions are excluded. Camera IDs may change with device re-enumeration. Small sample sizes and other system conditions prevent causal conclusions." });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
// Sample device and recording state periodically. Never interpret a failed device scan
// as a mass disconnection. The journal only stores state transitions, not every poll.
let healthSampleInFlight: Promise<void> | null = null;
function sampleCameraHealth(): Promise<void> {
  if (healthSampleInFlight) return healthSampleInFlight;
  const work = (async () => {
    const devices = await discoverDevices(); // throws on discovery failure
    const video = devices.filter(device => device.kind === "video");
    const captures = cameraCaptureManager.list();
    const states = video.map(device => ({ cameraId: device.id, cameraName: device.name,
      connected: true, recordingActive: captures.some(c => c.cameraId === device.id) }));
    for (const capture of captures) if (!states.some(c => c.cameraId === capture.cameraId))
      states.push({ cameraId: capture.cameraId, cameraName: capture.cameraId,
        connected: false, recordingActive: true });
    await appendCameraHealthSnapshot(states);
  })();
  healthSampleInFlight = work.finally(() => { healthSampleInFlight = null; });
  return healthSampleInFlight;
}
app.get("/api/camera-health/history", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await sampleCameraHealth();
    const limit = Number(req.query.limit ?? 200);
    res.json({ checkedAt: new Date().toISOString(), ...(await readCameraHealthHistory(limit)) });
  } catch (error) { res.status(503).json({ error: `Health history sample unavailable: ${String(error)}` }); }
});
app.get("/api/camera-health/disconnections", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await sampleCameraHealth();
    res.json(await analyzeCameraDisconnections());
  } catch (error) {
    res.status(503).json({ error: `Disconnection analysis unavailable: ${String(error)}` });
  }
});
app.get("/api/camera-health/recording-correlation", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await sampleCameraHealth();
    const seconds = Number(req.query.windowSeconds ?? 60);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)
      return res.status(400).json({ error: "windowSeconds must be between 0 and 600" });
    return res.json(await analyzeUsbRecordingCorrelation(seconds));
  } catch (error) {
    return res.status(503).json({ error: `USB/recording correlation unavailable: ${String(error)}` });
  }
});
// Compare failed recording end timestamps against actual historical resource samples.
app.get("/api/camera-health/resource-failure-correlation", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const seconds = Number(req.query.windowSeconds ?? 120);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)
    return res.status(400).json({ error: "windowSeconds must be between 0 and 600" });
  try { return res.json(await analyzeResourceFailureCorrelation(seconds)); }
  catch (error) { return res.status(503).json({ error: `Resource/failure analysis unavailable: ${String(error)}` }); }
});
app.get("/api/camera-health/diagnostic-thresholds", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await readDiagnosticThresholds());
});
app.put("/api/camera-health/diagnostic-thresholds", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await saveDiagnosticThresholds(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/camera-health/failure-investigation", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const seconds = Number(req.query.windowSeconds ?? 120);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)
    return res.status(400).json({ error: "windowSeconds must be between 0 and 600" });
  try { return res.json(await investigateRecordingFailures(seconds)); }
  catch (error) { return res.status(503).json({ error: `Failure investigation unavailable: ${String(error)}` }); }
});
// Unified, read-only troubleshooting snapshot. Resource metrics are sampled now,
// not reconstructed at the time of historical recording failures.
app.get("/api/camera-health/troubleshooting-report", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const seconds = Number(req.query.windowSeconds ?? 60);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)
    return res.status(400).json({ error: "windowSeconds must be between 0 and 600" });
  try {
    await sampleCameraHealth();
    const [correlation, disconnections, resources] = await Promise.all([
      analyzeUsbRecordingCorrelation(seconds), analyzeCameraDisconnections(), readSystemResources()
    ]);
    return res.json({ generatedAt: new Date().toISOString(), correlation, disconnections, resources,
      limitations: [
        "System resources are a current point-in-time sample, not historical measurements during recording failures.",
        "USB disconnects are sampled approximately every 30 seconds and may miss brief outages.",
        "Correlated timestamps do not establish the cause of a recording failure.",
        "Recording history is limited to the latest 200 sessions and USB history to 1,000 events.",
        "CPU/GPU/disk readings may be unavailable; disk throughput is system-wide."
      ] });
  } catch (error) {
    return res.status(503).json({ error: `Troubleshooting report unavailable: ${String(error)}` });
  }
});
app.get("/api/camera-health/usb-warnings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { await sampleCameraHealth(); res.json(await getUsbReliabilityWarnings()); }
  catch (error) { res.status(503).json({ error: `USB warning analysis unavailable: ${String(error)}` }); }
});
app.get("/api/camera-health/usb-warning-thresholds", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await readUsbThresholds());
});
app.put("/api/camera-health/usb-warning-thresholds", async (req, res) => {
  try { res.json(await saveUsbThresholds(req.body)); }
  catch (error) {
    const message = String(error);
    res.status(message.includes("must be") || message.includes("Expected") ? 400 : 500).json({ error: message });
  }
});
// A background sample captures changes even when no dashboard is open.
const healthSampleTimer = setInterval(() => {
  void sampleCameraHealth().catch(error => console.warn("Camera health sample failed:", error));
}, 30_000);
healthSampleTimer.unref();
void sampleCameraHealth().catch(error => console.warn("Initial camera health sample failed:", error));

// Combined, read-only camera health summary. A missing camera is not necessarily a failure:
// disconnected devices and journal camera IDs can differ after USB re-enumeration.
app.get("/api/camera-health", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const [devices, entries, settings] = await Promise.all([
      discoverDevices(), getRecordingHistory(200), readReliabilitySettings()
    ]);
    const videoDevices = devices.filter(device => device.kind === "video");
    const active = cameraCaptureManager.list();
    const activePaths = new Set(active.map(capture => capture.recordingPath));
    const names = new Map<string, string>();
    for (const device of videoDevices) names.set(device.id, device.name);
    for (const entry of entries) if (!names.has(entry.cameraId)) names.set(entry.cameraId, entry.cameraName);
    for (const issue of settings.issues) if (!names.has(issue.cameraId)) names.set(issue.cameraId, issue.cameraId);
    for (const capture of active) if (!names.has(capture.cameraId)) names.set(capture.cameraId, capture.cameraId);
    const { minCompleted, minFailed, minFailureRatePercent } = settings.thresholds;
    const cameras = [...names].map(([cameraId, cameraName]) => {
      const connected = videoDevices.some(device => device.id === cameraId);
      const capture = active.find(item => item.cameraId === cameraId);
      const history = entries.filter(entry => entry.cameraId === cameraId);
      const completed = history.filter(entry => !activePaths.has(entry.recordingPath) &&
        (entry.outcome === "failed" || entry.outcome === "stopped"));
      const failed = completed.filter(entry => entry.outcome === "failed").length;
      const failureRatePercent = completed.length ? Number((failed * 100 / completed.length).toFixed(1)) : null;
      const repeatedFailures = completed.length >= minCompleted && failed >= minFailed &&
        failureRatePercent !== null && failureRatePercent >= minFailureRatePercent;
      const knownIssue = settings.issues.find(issue => issue.cameraId === cameraId) ?? null;
      const warnings: string[] = [];
      if (!connected) warnings.push("Camera not currently detected (may be unplugged or re-enumerated)");
      if (repeatedFailures) warnings.push("Repeated recording failures exceed configured thresholds");
      if (knownIssue) warnings.push("Operator has recorded a known issue");
      return { cameraId, cameraName, connected, recordingActive: Boolean(capture),
        completedSessions: completed.length, failedSessions: failed, failureRatePercent,
        knownIssue, repeatedFailures, warnings,
        status: !connected ? "disconnected" : repeatedFailures || knownIssue ? "attention" :
          completed.length === 0 ? "untested" : "no-known-problems" };
    }).sort((a, b) => a.cameraName.localeCompare(b.cameraName));
    res.json({ checkedAt: new Date().toISOString(), cameras, thresholds: settings.thresholds,
      scannedSessions: entries.length, truncated: entries.length === 200,
      note: "Advisory snapshot only. Connected means Windows device discovery found a camera, not that video/audio is healthy. Recording status is current; reliability is from the most recent 200 journal entries. Missing cameras may be intentionally disconnected. No settings are changed." });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Persistent, operator-only reliability preferences and known camera notes.
app.get("/api/reliability-monitor/settings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await readReliabilitySettings()); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
app.put("/api/reliability-monitor/thresholds", async (req, res) => {
  try {
    const thresholds = validateThresholds(req.body);
    res.json(await changeReliabilitySettings(store => ({ ...store, thresholds })));
  } catch (error) { res.status(error instanceof Error && error.message.includes("must be") ? 400 : 500).json({ error: String(error) }); }
});
app.put("/api/reliability-monitor/issues/:cameraId", async (req, res) => {
  const cameraId = req.params.cameraId;
  const note = req.body?.note;
  if (!cameraId || cameraId.length > 300 || typeof note !== "string" || note.length > 2000) {
    res.status(400).json({ error: "Camera ID or note invalid (maximum 2000 characters)" }); return;
  }
  try {
    res.json(await changeReliabilitySettings(store => ({ ...store,
      issues: [...store.issues.filter(issue => issue.cameraId !== cameraId),
        { cameraId, note, updatedAt: new Date().toISOString() }].slice(-64) })));
  } catch (error) { res.status(500).json({ error: String(error) }); }
});
app.delete("/api/reliability-monitor/issues/:cameraId", async (req, res) => {
  try { res.json(await changeReliabilitySettings(store => ({ ...store,
    issues: store.issues.filter(issue => issue.cameraId !== req.params.cameraId) }))); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
// Advisory analysis only: no recording configuration is changed automatically.
app.get("/api/recording-history/reliability-warnings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const entries = await getRecordingHistory(200);
    const settings = await readReliabilitySettings();
    const { minCompleted, minFailed, minFailureRatePercent } = settings.thresholds;
    const activePaths = new Set(cameraCaptureManager.list().map(item => item.recordingPath));
    type Sample = { cameraId: string; cameraName: string; configurationKey: string; completed: number; failed: number };
    const groups = new Map<string, Sample>();
    let excluded = 0;
    for (const entry of entries) {
      const cfg = entry.captureConfiguration;
      if (activePaths.has(entry.recordingPath) ||
          (entry.outcome !== "failed" && entry.outcome !== "stopped") ||
          !cfg || cfg.source !== "recording-start" || !cfg.requested || !cfg.actualInput) {
        excluded++; continue;
      }
      const q = cfg.requested, input = cfg.actualInput;
      const values = [q.width, q.height, q.fps, q.recordingBitrateMbps,
        q.streamingBitrateKbps, input.width, input.height, input.fps];
      if (values.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0) ||
          typeof input.format !== "string" || !input.format.trim()) { excluded++; continue; }
      const configurationKey = JSON.stringify([...values, input.format]);
      const key = JSON.stringify([entry.cameraId, configurationKey]);
      const row = groups.get(key) ?? { cameraId: entry.cameraId, cameraName: entry.cameraName,
        configurationKey, completed: 0, failed: 0 };
      row.completed++;
      if (entry.outcome === "failed") row.failed++;
      groups.set(key, row);
    }
    const samples = [...groups.values()];
    type Warning = { code: string; severity: "warning" | "info"; cameraId?: string;
      cameraName?: string; configurationKey?: string; completed: number; failed: number;
      failureRatePercent: number; message: string };
    const warnings: Warning[] = [];
    for (const row of samples) {
      const rate = 100 * row.failed / row.completed;
      if (row.completed >= minCompleted && row.failed >= minFailed && rate >= minFailureRatePercent) {
        warnings.push({ code: "CAMERA_CONFIGURATION_FAILURES", severity: "warning",
          cameraId: row.cameraId, cameraName: row.cameraName,
          configurationKey: row.configurationKey, completed: row.completed, failed: row.failed,
          failureRatePercent: Number(rate.toFixed(1)),
          message: `${row.cameraName} has ${row.failed} failures in ${row.completed} completed sessions with one recording-start configuration. Check camera, cable, USB topology and system load.` });
      }
    }
    // Only compare devices sharing the *same exact* recorded configuration.
    const byConfig = new Map<string, Sample[]>();
    for (const row of samples) {
      const group = byConfig.get(row.configurationKey) ?? [];
      group.push(row); byConfig.set(row.configurationKey, group);
    }
    for (const [configurationKey, rows] of byConfig) {
      const affected = rows.filter(row => row.completed >= minCompleted && row.failed >= minFailed &&
        100 * row.failed / row.completed >= minFailureRatePercent);
      if (affected.length >= 2) {
        const completed = affected.reduce((n, row) => n + row.completed, 0);
        const failed = affected.reduce((n, row) => n + row.failed, 0);
        warnings.push({ code: "SHARED_CONFIGURATION_FAILURES", severity: "warning",
          configurationKey, completed, failed,
          failureRatePercent: Number((100 * failed / completed).toFixed(1)),
          message: `${affected.length} cameras show repeated failures with the same recording-start configuration. Check shared system resources and USB topology; this does not establish the cause.` });
      }
    }
    warnings.sort((a, b) => b.failureRatePercent - a.failureRatePercent);
    res.json({ generatedAt: new Date().toISOString(), historyLimit: 200,
      truncated: entries.length === 200, scannedSessions: entries.length, excluded,
      evaluatedGroups: samples.length, thresholds: settings.thresholds, knownIssues: settings.issues,
      warnings, note: "Advisory only. Failures are journal outcomes, not proof of USB or encoding faults. Small samples, incomplete journal history, changing camera IDs and differing event conditions limit conclusions. No settings are changed." });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
// Restrict validation to recorded sessions, not arbitrary filesystem paths.
// One check at a time prevents ffprobe jobs from competing with live encoders.
let validationInProgress = false;
app.post("/api/recording-history/validate", async (req, res) => {
  if (validationInProgress) { res.status(429).json({ error: "A validation is already running" }); return; }
  const recordingPath = req.body?.recordingPath;
  if (typeof recordingPath !== "string") { res.status(400).json({ error: "recordingPath required" }); return; }
  validationInProgress = true;
  try {
    const history = await getRecordingHistory(200);
    if (!history.some(item => item.recordingPath === recordingPath)) {
      res.status(404).json({ error: "Recording not found in recent history" }); return;
    }
    if (cameraCaptureManager.list().some(item => item.recordingPath === recordingPath)) {
      res.status(409).json({ error: "Stop recording before validating its segments" }); return;
    }
    const result = await validateRecordingSegments(recordingPath);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
  finally { validationInProgress = false; }
});
app.get("/api/recording-events", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ events: recentRecordingEvents() }); });
const PORT = Number(process.env.PORT || 3001);

const previewSessionManager = new PreviewSessionManager();
const previewProcessManager = new PreviewProcessManager();
const previewBusy = new Set<string>();
const youtubeStreams = new YouTubeStreamManager();

// Resolve by DirectShow alternative ID, never by enumeration order. The same
// camera can have several identical-looking microphone names.
async function resolveMicrophone(cameraId: string, requestedName?: string, requestedId?: string): Promise<{ name: string; input: string }> {
  const devices = (await discoverDevices()).filter(device => device.kind === "audio");
  const savedId = getSettings().devices[cameraId]?.pairedMicrophoneId;
  const id = requestedId || savedId;
  if (id) {
    const match = devices.find(device => device.id === id);
    if (!match) throw new Error(`Saved microphone is disconnected for camera ${cameraId}. Reassign it in Device Management.`);
    return { name: match.name, input: match.alternativeName || match.name };
  }
  if (!requestedName) throw new Error(`Assign a microphone to camera ${cameraId} before recording.`);
  const matches = devices.filter(device => device.name === requestedName);
  if (matches.length !== 1) throw new Error(matches.length === 0
    ? `Microphone not found: ${requestedName}`
    : `Multiple microphones named ${requestedName}. Select a specific microphone in Device Management.`);
  return { name: matches[0].name, input: matches[0].alternativeName || matches[0].name };
}


const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(
  currentDirectory,
  "../../../recordings"
);


// Persistent non-secret configuration. Changes to network binding take effect after restart.
app.get("/api/settings", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ settings: getSettings() }); });
app.put("/api/settings", (req, res) => {
  try { res.json({ settings: saveSettings(req.body) , restartRequired: true }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/config/backup", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'attachment; filename="tournament-backup.json"');
  res.json(exportBackup(getSession()));
});
app.post("/api/config/restore", (req, res) => {
  if (cameraCaptureManager.list().some(c => c.capture.isRunning)) { res.status(409).json({ error: "Stop recordings before restoring a backup" }); return; }
  try {
    if (req.body?.format !== "tournament-backup-v1") throw new Error("Unsupported backup format");
    // Validate settings before writing; session is validated by setSession.
    const settings = saveSettings(req.body.settings);
    const session = req.body.session == null ? getSession() : setSession(req.body.session);
    res.json({ success: true, settings, session, restartRequired: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Never return saved stream keys to browsers, logs or configuration backups.
app.get("/api/youtube/profiles", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json({ profiles: listYouTubeProfiles() }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.put("/api/youtube/profiles/:cameraId", (req, res) => {
  try {
    saveYouTubeProfile(req.params.cameraId, req.body?.label, req.body?.streamKey);
    res.json({ success: true, profiles: listYouTubeProfiles() });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.delete("/api/youtube/profiles/:cameraId", (req, res) => {
  try { deleteYouTubeProfile(req.params.cameraId); res.json({ success: true, profiles: listYouTubeProfiles() }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Explicit operator action only. This endpoint accepts secrets and never echoes them.
app.post("/api/youtube/profiles/import", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = importYouTubeProfiles(req.body, false);
    res.json({ success: true, ...result, profiles: listYouTubeProfiles() });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid import" }); }
});

// Live keys are never returned by GET. Saved keys are decrypted only on start.

app.get("/api/youtube/streams", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ streams: youtubeStreams.list() });
});

app.post("/api/youtube/:cameraId/start", (req, res) => {
  const cameraId = req.params.cameraId;
  const streamKey = req.body?.streamKey;
  let effectiveKey: string;
  try {
    effectiveKey = typeof streamKey === "string" && streamKey.trim() ? streamKey.trim() : (getYouTubeKey(cameraId) || "");
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) }); return;
  }
  if (!effectiveKey) { res.status(400).json({ error: "Save a stream profile or provide a stream key." }); return; }
  const capture = cameraCaptureManager.get(cameraId);
  if (!capture?.capture.isRunning) {
    res.status(409).json({ error: "Start local recording first. YouTube uses the existing capture." });
    return;
  }
  // Avoid accidental local UDP port reuse between distinct camera IDs.
  const collision = cameraCaptureManager.list().find(
    (other) => other.cameraId !== cameraId && streamPort(other.cameraId) === streamPort(cameraId)
  );
  if (collision) {
    res.status(409).json({ error: "Camera transport port collision. Change stream-port allocation." });
    return;
  }
  try {
    youtubeStreams.start(cameraId, effectiveKey);
    res.json({ success: true, stream: youtubeStreams.get(cameraId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not start relay." });
  }
});

// Bulk YouTube controls only operate on already-running local recordings.
// A failed relay does not stop its local recording or any other relay.
app.post("/api/youtube/start-all", async (_req, res) => {
  const session = getSession();
  if (!session?.assignments.length) {
    res.status(409).json({ error: "Save a tournament session first." }); return;
  }
  const results: { cameraId: string; ok: boolean; error?: string }[] = [];
  for (const assignment of session.assignments) {
    const cameraId = assignment.cameraId;
    try {
      const capture = cameraCaptureManager.get(cameraId);
      if (!capture?.capture.isRunning) throw new Error("Local recording is not running.");
      if (youtubeStreams.get(cameraId)) {
        results.push({ cameraId, ok: true }); continue;
      }
      const collision = cameraCaptureManager.list().find(other =>
        other.cameraId !== cameraId && streamPort(other.cameraId) === streamPort(cameraId));
      if (collision) throw new Error("Camera transport port collision.");
      const key = getYouTubeKey(cameraId);
      if (!key) throw new Error("No saved YouTube stream key for this camera.");
      youtubeStreams.start(cameraId, key);
      results.push({ cameraId, ok: true });
    } catch (error) {
      results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  res.status(results.some(r => !r.ok) ? 207 : 200).json({ results });
});

app.post("/api/youtube/stop-all", async (_req, res) => {
  try {
    await youtubeStreams.stopAll();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/youtube/:cameraId/stop", async (req, res) => {
  try {
    const stopped = await youtubeStreams.stop(req.params.cameraId);
    res.json({ success: true, stopped });
  } catch {
    res.status(500).json({ error: "Could not stop YouTube relay." });
  }
});

app.get("/api/session/templates", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json({ templates: listTournamentTemplates() }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/session/templates/:templateId", (req, res) => {
  try { res.json({ template: getTournamentTemplate(req.params.templateId) }); }
  catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/session/templates", (req, res) => {
  if (cameraCaptureManager.list().some(c => c.capture.isRunning) || youtubeStreams.list().length) {
    res.status(409).json({ error: "Stop recordings and YouTube streams before saving a template." }); return;
  }
  try { res.status(201).json({ template: saveTournamentTemplate(req.body?.name) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/session/events", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ events: listTournamentEvents(), selectedEventId: getSession()?.eventId ?? null });
});

app.post("/api/session/select-event", (req, res) => {
  if (cameraCaptureManager.list().some(c => c.capture.isRunning) || youtubeStreams.list().length) {
    res.status(409).json({ error: "Stop recordings and YouTube streams before switching tournaments." }); return;
  }
  try {
    if (typeof req.body?.eventId !== "string") throw new Error("Tournament ID required.");
    res.json({ session: selectTournamentEvent(req.body.eventId) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/session", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ session: getSession() });
});

app.put("/api/session", (req, res) => {
  if (cameraCaptureManager.list().some((capture) => capture.capture.isRunning) || youtubeStreams.list().length) {
    res.status(409).json({ error: "Stop recordings and YouTube streams before changing the session." });
    return;
  }
  try { res.json({ session: setSession(req.body) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid session" }); }
});

// Explicitly create a distinct event, even if its name is reused.
app.post("/api/session/new-event", (req, res) => {
  if (cameraCaptureManager.list().some(c => c.capture.isRunning) || youtubeStreams.list().length) {
    res.status(409).json({ error: "Stop recordings and YouTube streams before creating a new event." }); return;
  }
  try { res.json({ session: setSession(req.body, true) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid session" }); }
});

// Read-only preflight. Checks configuration, device presence, and recording disk capacity.
// It does not open cameras, reserve USB bandwidth, or guarantee successful capture.
async function checkSessionPreflight(session: ReturnType<typeof getSession>, res: import("express").Response, source: "saved" | "draft") {
  const checks: { level: "ok" | "warning" | "error"; message: string }[] = [];
  if (!session || !session.assignments.length) {
    checks.push({ level: "error", message: "Assign at least one ring before running preflight." });
  } else {
    if (!session.eventName?.trim()) checks.push({ level: "error", message: "Tournament name is missing." });
    const ringNames = new Set<string>();
    const cameraIds = new Set<string>();
    const micIds = new Set<string>();
    let devices: Awaited<ReturnType<typeof discoverDevices>> = [];
    try { devices = await discoverDevices(); }
    catch (error) { checks.push({ level: "error", message: `Device discovery failed: ${String(error)}` }); }
    for (const assignment of session.assignments) {
      const label = assignment.ring || assignment.cameraName || assignment.cameraId;
      if (!assignment.ring?.trim()) checks.push({ level: "error", message: `Ring name missing for ${assignment.cameraName}.` });
      const normalizedRing = assignment.ring?.trim().toLowerCase();
      if (normalizedRing && ringNames.has(normalizedRing)) checks.push({ level: "error", message: `Duplicate ring: ${assignment.ring}.` });
      if (normalizedRing) ringNames.add(normalizedRing);
      if (cameraIds.has(assignment.cameraId)) checks.push({ level: "error", message: `Camera assigned more than once: ${label}.` });
      cameraIds.add(assignment.cameraId);
      if (!devices.some(d => d.kind === "video" && d.id === assignment.cameraId))
        checks.push({ level: "error", message: `${label}: camera is not connected.` });
      const configuredMicId = getSettings().devices[assignment.cameraId]?.pairedMicrophoneId;
      const matchingMics = configuredMicId
        ? devices.filter(d => d.kind === "audio" && d.id === configuredMicId)
        : devices.filter(d => d.kind === "audio" && d.name === assignment.microphoneName);
      if (matchingMics.length !== 1) {
        checks.push({ level: "error", message: `${label}: microphone ${matchingMics.length ? "is ambiguous" : "is missing or disconnected"}.` });
      } else {
        if (micIds.has(matchingMics[0].id)) checks.push({ level: "warning", message: `${label}: microphone is also assigned to another ring.` });
        micIds.add(matchingMics[0].id);
      }
      if (cameraCaptureManager.get(assignment.cameraId)?.capture.isRunning)
        checks.push({ level: "warning", message: `${label}: recording is already running.` });
    }
  }
  let freeBytes: number | null = null;
  try {
    await mkdir(outputDirectory, { recursive: true });
    const disk = await statfs(outputDirectory, { bigint: true });
    freeBytes = Number(disk.bavail * disk.bsize);
    const freeGiB = freeBytes / (1024 ** 3);
    checks.push({ level: freeGiB < STORAGE_CRITICAL_GIB ? "error" : freeGiB < STORAGE_WARNING_GIB ? "warning" : "ok",
      message: `Recording disk: ${freeGiB.toFixed(1)} GiB free.` });
  } catch (error) {
    checks.push({ level: "warning", message: `Could not check recording disk: ${String(error)}` });
  }
  if (!checks.some(c => c.level === "error" || c.level === "warning"))
    checks.unshift({ level: "ok", message: "Configuration and connected devices passed preflight." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ready: !checks.some(c => c.level === "error"), checks, freeBytes,
    checkedAt: new Date().toISOString(), source });
}

app.get("/api/session/preflight", async (_req, res) => {
  await checkSessionPreflight(getSession(), res, "saved");
});

// Validate the editor's current unsaved assignments without modifying the
// persistent session, event ID, or saved templates.
app.post("/api/session/preflight", async (req, res) => {
  const input = req.body;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.eventName !== "string" || input.eventName.length > 200 ||
      !Array.isArray(input.assignments) || input.assignments.length > 8 ||
      !input.assignments.every((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const value = entry as Record<string, unknown>;
        return ["cameraId", "cameraName", "microphoneName", "ring"].every(key =>
          typeof value[key] === "string" && (value[key] as string).length <= 256);
      })) {
    res.status(400).json({ error: "Invalid draft session (maximum 8 assignments)." });
    return;
  }
  await checkSessionPreflight(input as ReturnType<typeof getSession>, res, "draft");
});

// Thresholds are set on backend startup; no browser request can lower them.
function thresholdGiB(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : fallback;
}
const STORAGE_CRITICAL_GIB = thresholdGiB("TOURNAMENT_STORAGE_CRITICAL_GIB", 10);
const STORAGE_WARNING_GIB = Math.max(
  STORAGE_CRITICAL_GIB, thresholdGiB("TOURNAMENT_STORAGE_WARNING_GIB", 50)
);
async function assertRecordingSpace(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const disk = await statfs(outputDirectory, { bigint: true });
  const freeGiB = Number(disk.bavail * disk.bsize) / (1024 ** 3);
  if (freeGiB < STORAGE_CRITICAL_GIB) {
    throw new Error(`Recording blocked: ${freeGiB.toFixed(1)} GiB free, below ${STORAGE_CRITICAL_GIB} GiB minimum.`);
  }
}

// Each camera is started independently. Failures are reported per camera, not hidden.
app.post("/api/session/start-all", async (_req, res) => {
  const session = getSession();
  if (!session) { res.status(409).json({ error: "Configure a tournament session first." }); return; }
  const results: { cameraId: string; ok: boolean; error?: string }[] = [];
  for (const assignment of session.assignments) {
    const { cameraId, cameraName, microphoneName } = assignment;
    if (cameraCaptureManager.get(cameraId)?.capture.isRunning) {
      results.push({ cameraId, ok: true }); continue;
    }
    if (previewBusy.has(cameraId)) {
      results.push({ cameraId, ok: false, error: "Camera busy" }); continue;
    }
    previewBusy.add(cameraId);
    const wasPreviewing = !!previewSessionManager.get(cameraId);
    try {
      if (wasPreviewing) await previewProcessManager.stop(cameraId);
      await assertRecordingSpace();
      const mic = await resolveMicrophone(cameraId, microphoneName);
      await cameraCaptureManager.start(cameraId, cameraName, cameraId, mic.input,
        recordingDirectory(outputDirectory, cameraId));
      results.push({ cameraId, ok: true });
    } catch (error) {
      if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
        try { await previewProcessManager.start(cameraId); } catch { /* reported by preview status */ }
      }
      results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally { previewBusy.delete(cameraId); }
  }
  res.status(results.some((item) => !item.ok) ? 207 : 200).json({ results });
});

app.post("/api/session/stop-all", async (_req, res) => {
  const results: { cameraId: string; ok: boolean; error?: string }[] = [];
  for (const managed of cameraCaptureManager.list()) {
    const cameraId = managed.cameraId;
    try {
      await youtubeStreams.stop(cameraId);
      await cameraCaptureManager.stop(cameraId);
      if (previewSessionManager.get(cameraId)) {
        try { await previewProcessManager.start(cameraId); } catch { /* preview can be restarted manually */ }
      }
      results.push({ cameraId, ok: true });
    } catch (error) {
      results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  res.status(results.some((item) => !item.ok) ? 207 : 200).json({ results });
});

// Server-side recording health. Monitoring is passive: it never restarts FFmpeg.
// A 15-second grace period avoids warning during initial encoder startup.
const recordingGrowth = new Map<string, { startedAt: string; bytes: number; lastGrowthAt: number }>();
// One inexpensive simultaneous snapshot of all active recording pipelines.
// A stress test uses repeated snapshots and never starts/stops cameras itself.
// FFmpeg reports aggregate progress for its multi-output capture process.
// These are encoder diagnostics, not independently measured per-output FPS.
app.get("/api/captures/encoder-stats", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ checkedAt: Date.now(), captures: cameraCaptureManager.list().map(item => ({
    cameraId: item.cameraId, cameraName: item.cameraName, startedAt: item.startedAt,
    running: item.capture.isRunning, encoder: item.capture.getEncoderStats()
  })) });
});

app.get("/api/captures/stress-snapshot", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const checkedAt = Date.now();
  const captures = await Promise.all(cameraCaptureManager.list().map(async item => {
    const stats = item.capture.getFrameStats();
    const segments = await item.capture.getRecordingSegments();
    const bytes = await item.capture.getRecordingFileSize();
    return {
      cameraId: item.cameraId, cameraName: item.cameraName,
      startedAt: item.startedAt, running: item.capture.isRunning,
      frameCount: stats.frameCount, frameAgeMs: stats.frameAgeMs,
      recordingBytes: bytes, segmentCount: segments.length
    };
  }));
  res.json({ checkedAt, captures });
});

app.get("/api/captures/health", async (_req, res) => {
  const now = Date.now();
  const active = cameraCaptureManager.list().filter(item => item.capture.isRunning);
  const activeIds = new Set(active.map(item => item.cameraId));
  for (const id of recordingGrowth.keys()) if (!activeIds.has(id)) recordingGrowth.delete(id);
  const captures = await Promise.all(active.map(async item => {
    const stats = item.capture.getFrameStats();
    let bytes: number | null = null;
    try { bytes = await item.capture.getRecordingFileSize(); } catch { /* unavailable */ }
    const previous = recordingGrowth.get(item.cameraId);
    const growth = !previous || previous.startedAt !== item.startedAt ||
      (bytes !== null && bytes > previous.bytes)
      ? { startedAt: item.startedAt, bytes: bytes ?? 0, lastGrowthAt: now }
      : previous;
    recordingGrowth.set(item.cameraId, growth);
    const ageMs = Math.max(0, now - new Date(item.startedAt).getTime());
    const warnings: string[] = [];
    if (ageMs > 15000) {
      if (stats.frameAgeMs === null || stats.frameAgeMs > 5000)
        warnings.push("No recent video frames (over 5 seconds).");
      if (bytes === null) warnings.push("Recording file size is unavailable.");
      else if (now - growth.lastGrowthAt > 15000)
        warnings.push("Recording file has not grown for over 15 seconds.");
    }
    return {
      cameraId: item.cameraId, cameraName: item.cameraName,
      status: warnings.length ? "warning" : ageMs <= 15000 ? "starting" : "healthy",
      warnings, recordingFileSize: bytes, frameAgeMs: stats.frameAgeMs,
      fileGrowthAgeMs: now - growth.lastGrowthAt, startedAt: item.startedAt
    };
  }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ checkedAt: new Date(now).toISOString(), captures });
});

// Recovery safeguards: automatic recovery is disabled unless explicitly opted in.
// Manual and automatic recovery share the same cooldown and hourly retry budget.
const AUTO_RECOVERY = process.env.TOURNAMENT_AUTO_RECOVERY === "1";
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_MAX_PER_HOUR = 2;
const recoveryAttempts = new Map<string, number[]>();
const recoveringCaptures = new Set<string>();
const unhealthySamples = new Map<string, number>();
const recoveryMessages = new Map<string, string>();
function recoveryEligibility(cameraId: string): { allowed: boolean; reason?: string } {
  if (recoveringCaptures.has(cameraId) || previewBusy.has(cameraId)) return { allowed: false, reason: "Camera operation in progress" };
  const now = Date.now();
  const attempts = (recoveryAttempts.get(cameraId) ?? []).filter(t => now - t < RECOVERY_WINDOW_MS);
  recoveryAttempts.set(cameraId, attempts);
  if (attempts.length >= RECOVERY_MAX_PER_HOUR) return { allowed: false, reason: "Recovery limit reached (2 per hour)" };
  if (attempts.length && now - attempts[attempts.length - 1] < RECOVERY_COOLDOWN_MS)
    return { allowed: false, reason: "Recovery cooldown active (5 minutes)" };
  return { allowed: true };
}
async function recoverCapture(cameraId: string): Promise<string> {
  const eligibility = recoveryEligibility(cameraId);
  if (!eligibility.allowed) throw new Error(eligibility.reason);
  const managed = cameraCaptureManager.get(cameraId);
  if (!managed?.capture.isRunning) throw new Error("Camera is not recording.");
  recoveringCaptures.add(cameraId);
  previewBusy.add(cameraId);
  recoveryAttempts.set(cameraId, [...(recoveryAttempts.get(cameraId) ?? []), Date.now()]);
  const wasPreviewing = !!previewSessionManager.get(cameraId);
  try {
    await youtubeStreams.stop(cameraId);
    await cameraCaptureManager.stop(cameraId);
    recordingGrowth.delete(cameraId);
    const mic = await resolveMicrophone(cameraId, managed.microphoneName);
    const restarted = await cameraCaptureManager.start(cameraId, managed.cameraName, cameraId,
      mic.input, recordingDirectory(outputDirectory, cameraId));
    const message = `New recording: ${restarted.recordingPath}. Restart YouTube manually.`;
    recoveryMessages.set(cameraId, message);
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recoveryMessages.set(cameraId, `Recovery failed: ${message}`);
    if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
      try { await previewProcessManager.start(cameraId); } catch { /* keep original failure */ }
    }
    throw error;
  } finally {
    previewBusy.delete(cameraId);
    recoveringCaptures.delete(cameraId);
  }
}
app.get("/api/captures/recovery-status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ automaticEnabled: AUTO_RECOVERY, cooldownMinutes: 5, maxAttemptsPerHour: 2,
    cameras: cameraCaptureManager.list().map(item => ({ cameraId: item.cameraId,
      ...recoveryEligibility(item.cameraId),
      attemptsInLastHour: (recoveryAttempts.get(item.cameraId) ?? []).length,
      lastResult: recoveryMessages.get(item.cameraId) ?? null })) });
});
app.post("/api/captures/:cameraId/recover", async (req, res) => {
  try {
    const message = await recoverCapture(req.params.cameraId);
    res.json({ success: true, cameraId: req.params.cameraId, message });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Opt-in watchdog: requires three consecutive unhealthy samples, sampled 10 seconds
// apart. Never interrupts an active YouTube relay automatically.
let watchdogBusy = false;
if (AUTO_RECOVERY) {
  setInterval(async () => {
    if (watchdogBusy) return;
    watchdogBusy = true;
    try {
      const now = Date.now();
      const active = cameraCaptureManager.list().filter(item => item.capture.isRunning);
      const activeIds = new Set(active.map(item => item.cameraId));
      for (const id of unhealthySamples.keys()) if (!activeIds.has(id)) unhealthySamples.delete(id);
      for (const item of active) {
        const age = now - new Date(item.startedAt).getTime();
        if (age < 30000) { unhealthySamples.delete(item.cameraId); continue; }
        const stats = item.capture.getFrameStats();
        const size = await item.capture.getRecordingFileSize().catch(() => null);
        const previous = recordingGrowth.get(item.cameraId);
        const stalled = (stats.frameAgeMs === null || stats.frameAgeMs > 10000) &&
          (size === null || (!!previous && now - previous.lastGrowthAt > 20000));
        const samples = stalled ? (unhealthySamples.get(item.cameraId) ?? 0) + 1 : 0;
        unhealthySamples.set(item.cameraId, samples);
        if (samples < 3 || !recoveryEligibility(item.cameraId).allowed) continue;
        // Active streams must never be terminated by the unattended watchdog.
        if (youtubeStreams.list().some(stream => stream.cameraId === item.cameraId)) continue;
        unhealthySamples.set(item.cameraId, 0);
        try { await recoverCapture(item.cameraId); }
        catch (error) { console.error("Automatic recovery failed:", item.cameraId, error); }
      }
    } catch (error) { console.error("Recovery watchdog error:", error); }
    finally { watchdogBusy = false; }
  }, 10000);
}

// Probe a connected, idle camera only. DirectShow probing can fail when the
// camera is already opened by another process.
app.get("/api/cameras/:cameraId/capabilities", async (req, res) => {
  try {
    const devices = await discoverDevices();
    const camera = devices.find(d => d.kind === "video" && d.id === req.params.cameraId);
    if (!camera) { res.status(404).json({ error: "Camera not found." }); return; }
    if (cameraCaptureManager.get(camera.id)) {
      res.status(409).json({ error: "Stop recording before probing camera modes." }); return;
    }
    const result = await probeCameraCapabilities(camera.name);
    const requestedFps = process.env.TOURNAMENT_CAPTURE_FPS === "60" ? 60 : 30;
    res.json({ ...result, requestedFps, selectedMode: selectCameraMode(result.modes, requestedFps) });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Fixed presets avoid arbitrary user-provided FFmpeg arguments.
const CAMERA_QUALITY_PRESETS = {
  "standard-1080p30": { width: 1920, height: 1080, fps: 30, recordingBitrateMbps: 12, streamingBitrateKbps: 4500 },
  "high-1080p60": { width: 1920, height: 1080, fps: 60, recordingBitrateMbps: 16, streamingBitrateKbps: 4500 },
  "usb-light-720p30": { width: 1280, height: 720, fps: 30, recordingBitrateMbps: 6, streamingBitrateKbps: 3500 }
} as const;
app.get("/api/camera-quality/presets", (_req, res) => {
  res.json({ presets: CAMERA_QUALITY_PRESETS });
});
app.post("/api/camera-quality/apply-preset", async (req, res) => {
  try {
    const presetId = req.body?.presetId;
    if (typeof presetId !== "string" || !Object.prototype.hasOwnProperty.call(CAMERA_QUALITY_PRESETS, presetId)) {
      res.status(400).json({ error: "Unknown quality preset." }); return;
    }
    const cameraIds: unknown = req.body?.cameraIds;
    if (!Array.isArray(cameraIds) || cameraIds.length < 1 || cameraIds.length > 16 ||
        cameraIds.some(id => typeof id !== "string") || new Set(cameraIds).size !== cameraIds.length) {
      res.status(400).json({ error: "Choose 1 to 16 unique cameras." }); return;
    }
    const available = await discoverDevices();
    const knownIds = new Set(available.filter(device => device.kind === "video").map(device => device.id));
    const unknown = cameraIds.filter(id => !knownIds.has(id));
    if (unknown.length) { res.status(400).json({ error: "One or more selected cameras are not connected." }); return; }
    const busy = cameraIds.filter(id => cameraCaptureManager.get(id));
    if (busy.length) { res.status(409).json({ error: "Stop recording on every selected camera before applying a preset.", cameraIds: busy }); return; }
    const quality = CAMERA_QUALITY_PRESETS[presetId as keyof typeof CAMERA_QUALITY_PRESETS];
    const updated = saveCameraQualityBulk(cameraIds, quality);
    res.json({ updated, presetId, quality, appliesOnNextRecording: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Quality changes apply to future recordings only; running FFmpeg processes are untouched.
app.get("/api/camera-quality", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ overrides: listCameraQualityOverrides() });
});
app.get("/api/camera-quality/:cameraId", (req, res) => {
  res.json({ quality: getCameraQuality(req.params.cameraId) });
});
app.put("/api/camera-quality/:cameraId", (req, res) => {
  if (cameraCaptureManager.get(req.params.cameraId)?.capture.isRunning) {
    res.status(409).json({ error: "Stop this camera's recording before changing quality." }); return;
  }
  try { res.json({ quality: saveCameraQuality(req.params.cameraId, req.body), appliesOnNextRecording: true }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.delete("/api/camera-quality/:cameraId", (req, res) => {
  if (cameraCaptureManager.get(req.params.cameraId)?.capture.isRunning) {
    res.status(409).json({ error: "Stop this camera's recording before resetting quality." }); return;
  }
  try { deleteCameraQuality(req.params.cameraId); res.json({ quality: getCameraQuality(req.params.cameraId) }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

// Read-only effective quality settings. Restart backend after changing env vars.
app.get("/api/capture-quality", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getCaptureQualitySettings());
});

app.get("/api/captures", async (_req, res) => {
  const captures = await Promise.all(cameraCaptureManager.list().map(async (managed) => {
    const frameStats = managed.capture.getFrameStats();
const recordingFileSize = await managed.capture.getRecordingFileSize();
    const recordingSegments = await managed.capture.getRecordingSegments();
    return {
      cameraId: managed.cameraId,
      cameraName: managed.cameraName,
      microphoneName: managed.microphoneName,
      recordingPath: managed.recordingPath,
      selectedMode: managed.selectedMode ?? null,
      configuredQuality: managed.configuredQuality ?? null,
      running: managed.capture.isRunning,
      startedAt: managed.startedAt,
      previewAvailable: managed.capture.getFrame() !== null,
      recordingFileSize,
      segmentCount: recordingSegments.length,
      activeSegment: recordingSegments.at(-1)?.path ?? null,
      recordingSegments,
      lastFrameAt: frameStats.lastFrameAt,
      frameCount: frameStats.frameCount,
      frameAgeMs: frameStats.frameAgeMs,
      previewFrozen:
        managed.capture.isRunning &&
        frameStats.frameAgeMs !== null &&
        frameStats.frameAgeMs > 3000
    };
    })
);

  res.json({
    count: captures.length,
    captures
  });
});


app.post("/api/captures/start", async (req, res) => {
  const { cameraId, cameraName, cameraDeviceId, microphoneName, microphoneId } = req.body ?? {};

  if (
    typeof cameraId !== "string" ||
    !cameraId.trim() ||
    typeof cameraName !== "string" ||
    !cameraName.trim() ||
    typeof microphoneName !== "string" ||
    !microphoneName.trim() ||
    typeof cameraDeviceId !== "string" ||
!cameraDeviceId.trim()
  ) {
    res.status(400).json({
      error: "cameraId, cameraName, and microphoneName are required."
    });
    return;
  }

  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  previewBusy.add(cameraId);
  const wasPreviewing = !!previewSessionManager.get(cameraId);
  try {
    if (wasPreviewing) await previewProcessManager.stop(cameraId);
    await assertRecordingSpace();
    const resolvedMic = await resolveMicrophone(cameraId, microphoneName, microphoneId);
    const managed = await cameraCaptureManager.start(
  cameraId,
  cameraName,
  cameraDeviceId,
  resolvedMic.input,
  recordingDirectory(outputDirectory, cameraId)
    );

    res.json({
      success: true,
      cameraId: managed.cameraId,
      cameraName: managed.cameraName,
      microphoneName: managed.microphoneName,
      recordingPath: managed.recordingPath,
      selectedMode: managed.selectedMode ?? null,
      configuredQuality: managed.configuredQuality ?? null,
      running: managed.capture.isRunning,
      previewAvailable: managed.capture.getFrame() !== null
    });
  } catch (error) {
    if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
      try { await previewProcessManager.start(cameraId); }
      catch (previewError) { console.error("Could not restore preview:", previewError); }
    }
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    previewBusy.delete(cameraId);
  }
});

function previewFrame(cameraId: string): Buffer | null {
  const recording = cameraCaptureManager.get(cameraId);
  if (recording?.capture.isRunning) return recording.capture.getFrame();
  return previewProcessManager.getFrame(cameraId);
}

app.get("/api/previews", (_req, res) => {
  const previews = previewSessionManager.list().map((session) => {
    const recording = cameraCaptureManager.get(session.cameraId);
    const shared = recording?.capture.isRunning ?? false;
    const stats = shared
      ? recording!.capture.getFrameStats()
      : previewProcessManager.getStats(session.cameraId);
    const frameAvailable = previewFrame(session.cameraId) !== null;
    return {
      ...session,
      status: frameAvailable && (shared || previewProcessManager.isRunning(session.cameraId))
        ? "running"
        : session.status === "error" || (!shared && !previewBusy.has(session.cameraId) && !previewProcessManager.isRunning(session.cameraId))
          ? "error" : "starting",
      source: shared ? "recording" : "standalone",
      previewAvailable: frameAvailable,
      frameCount: stats.frameCount,
      lastFrameAt: stats.lastFrameAt,
      frameAgeMs: stats.frameAgeMs,
      previewFrozen: stats.frameAgeMs !== null && stats.frameAgeMs > 3000
    };
  });
  res.json({ count: previews.length, previews });
});

// Explicit, operator-triggered device tests. Never interrupt live recordings.
const activeAudioTests = new Set<string>();
app.post("/api/device-test", async (req, res) => {
  const { cameraId, microphoneName } = req.body ?? {};
  if (typeof cameraId !== "string" || !cameraId ||
      typeof microphoneName !== "string" || !microphoneName) {
    res.status(400).json({ error: "cameraId and microphoneName are required." }); return;
  }
  if (activeAudioTests.has(microphoneName)) {
    res.status(409).json({ error: "This microphone is already being tested." }); return;
  }
  try {
    const devices = await discoverDevices();
    const camera = devices.find(d => d.kind === "video" && d.id === cameraId);
    const matchingMics = devices.filter(d => d.kind === "audio" && d.name === microphoneName);
    if (!camera || matchingMics.length !== 1) {
      res.status(400).json({ error: !camera ? "Camera is disconnected." :
        "Microphone is disconnected or its name is ambiguous. Assign a unique microphone device." }); return;
    }
    const recording = cameraCaptureManager.get(cameraId);
    let video: { status: string; frameAgeMs: number | null; message: string };
    if (recording?.capture.isRunning) {
      const stats = recording.capture.getFrameStats();
      video = { status: stats.frameAgeMs !== null && stats.frameAgeMs < 3000 ? "pass" : "warning",
        frameAgeMs: stats.frameAgeMs,
        message: stats.frameAgeMs !== null && stats.frameAgeMs < 3000 ? "Recording preview frames are fresh." : "No fresh recording frames." };
    } else if (previewProcessManager.isRunning(cameraId)) {
      const stats = previewProcessManager.getStats(cameraId);
      video = { status: stats.frameAgeMs !== null && stats.frameAgeMs < 3000 ? "pass" : "warning",
        frameAgeMs: stats.frameAgeMs,
        message: stats.frameAgeMs !== null && stats.frameAgeMs < 3000 ? "Preview frames are fresh." : "Preview is not producing fresh frames." };
    } else {
      video = { status: "not-running", frameAgeMs: null,
        message: "Start the camera preview, then run this test to verify live frames." };
    }
    const microphoneBusy = cameraCaptureManager.list().some(c => c.microphoneName === microphoneName);
    if (microphoneBusy) {
      res.json({ cameraId, microphoneName, video,
        audio: { status: "busy", meanDb: null, maxDb: null,
          message: "Microphone is in use by a recording. Stop it before testing the audio level." },
        checkedAt: new Date().toISOString() }); return;
    }
    activeAudioTests.add(microphoneName);
    try {
      const audio = await testMicrophoneLevel(microphoneName);
      res.json({ cameraId, microphoneName, video, audio, checkedAt: new Date().toISOString() });
    } finally { activeAudioTests.delete(microphoneName); }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/previews/start", async (req, res) => {
  const { cameraId, cameraName } = req.body ?? {};
  if (typeof cameraId !== "string" || !cameraId.trim() ||
      typeof cameraName !== "string" || !cameraName.trim()) {
    res.status(400).json({ error: "cameraId and cameraName are required." });
    return;
  }
  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  previewBusy.add(cameraId);
  try {
    const devices = await discoverDevices();
    if (!devices.some((device) => device.kind === "video" && device.id === cameraId)) {
      res.status(404).json({ error: "Camera device ID not found." });
      return;
    }
    const existing = previewSessionManager.get(cameraId);
    if (existing) {
      res.json({ success: true, preview: existing });
      return;
    }
    const preview = previewSessionManager.start(cameraId, cameraName);
    const recording = cameraCaptureManager.get(cameraId);
    if (!recording?.capture.isRunning) {
      await previewProcessManager.start(cameraId);
    }
    previewSessionManager.setStatus(cameraId, "running");
    res.json({ success: true, preview });
  } catch (error) {
    await previewProcessManager.stop(cameraId);
    previewSessionManager.stop(cameraId);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    previewBusy.delete(cameraId);
  }
});

app.post("/api/previews/:cameraId/stop", async (req, res) => {
  const cameraId = req.params.cameraId;
  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  previewBusy.add(cameraId);
  try {
    if (!previewSessionManager.get(cameraId)) {
      res.status(404).json({ error: "Preview session not found." });
      return;
    }
    await previewProcessManager.stop(cameraId);
    previewSessionManager.stop(cameraId);
    res.json({ success: true, cameraId });
  } finally {
    previewBusy.delete(cameraId);
  }
});

app.get("/api/previews/:cameraId/frame", (req, res) => {
  if (!previewSessionManager.get(req.params.cameraId)) {
    res.status(404).json({ error: "Preview session not found." });
    return;
  }
  const frame = previewFrame(req.params.cameraId);
  if (!frame) {
    res.status(404).json({ error: "No preview frame available." });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(frame);
});

app.get("/api/captures/:cameraId/frame", (req, res) => {
  const managed = cameraCaptureManager.get(req.params.cameraId);

  if (!managed || !managed.capture.isRunning) {
    res.status(404).json({
      error: "Camera capture is not running."
    });
    return;
  }

  const frame = managed.capture.getFrame();

  if (!frame) {
    res.status(404).json({
      error: "No preview frame available."
    });
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(frame);
});

app.post("/api/captures/stop-all", async (_req, res) => {
  try {
    const count = cameraCaptureManager.list().length;

    await youtubeStreams.stopAll();
    await cameraCaptureManager.stopAll();

    res.json({
      success: true,
      stoppedCount: count,
      message: "All managed camera captures stopped."
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/captures/:cameraId/stop", async (req, res) => {
  const cameraId = req.params.cameraId;
  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  previewBusy.add(cameraId);
  try {
    await youtubeStreams.stop(cameraId);
    await cameraCaptureManager.stop(cameraId);
    if (previewSessionManager.get(cameraId)) {
      try { await previewProcessManager.start(cameraId); }
      catch (error) {
        previewSessionManager.setStatus(cameraId, "error");
        console.error("Could not resume preview after recording:", error);
      }
    }

    res.json({
      success: true,
      cameraId,
      message: "Camera capture stopped."
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    previewBusy.delete(cameraId);
  }
});

app.post("/api/capture/test/start", async (req, res) => {
  const { cameraName, microphoneName } = req.body ?? {};

  if (
    typeof cameraName !== "string" ||
    !cameraName.trim() ||
    typeof microphoneName !== "string" ||
    !microphoneName.trim()
  ) {
    res.status(400).json({
      error: "cameraName and microphoneName are required."
    });
    return;
  }



if (
  sharedCapture.isRunning ||
  sharedCaptureStarting ||
  sharedCaptureStopping
) {

  res.status(409).json({
    error: "Shared capture is already running, starting, or stopping."
  });
  return;
}

sharedCaptureStarting = true;


  try {
    const recordingPath = await sharedCapture.start({
      cameraName,
      microphoneName,
      outputDirectory: path.resolve("recordings")
    });


await sharedCapture.waitUntilReady();

sharedCaptureCamera = cameraName;
sharedCaptureMicrophone = microphoneName;
sharedCaptureRecordingPath = recordingPath;

res.json({
  success: true,
  recordingPath
});

  
} catch (error) {
  await sharedCapture.stop().catch(console.error);

  res.status(500).json({
    error: error instanceof Error ? error.message : String(error)
  });
} finally {
  sharedCaptureStarting = false;
}

});



app.get("/api/capture/test/status", (_req, res) => {
  const running = sharedCapture.isRunning;

  res.json({
    running,
    starting: sharedCaptureStarting,
    stopping: sharedCaptureStopping,
    cameraName: running ? sharedCaptureCamera : null,
    microphoneName: running ? sharedCaptureMicrophone : null,
    recordingPath: running ? sharedCaptureRecordingPath : null,
    previewAvailable: running && sharedCapture.getFrame() !== null
  });
});

app.get("/api/capture/test/frame", (_req, res) => {
  const frame = sharedCapture.getFrame();

  if (!sharedCapture.isRunning || !frame) {
    res.status(404).json({
      error: "No active shared capture frame available."
    });
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(frame);
});



app.post("/api/capture/test/stop", async (_req, res) => {
  if (sharedCaptureStarting) {
    res.status(409).json({
      error: "Shared capture is still starting."
    });
    return;
  }

  if (sharedCaptureStopping) {
    res.status(409).json({
      error: "Shared capture is already stopping."
    });
    return;
  }

  if (!sharedCapture.isRunning) {
    res.json({
      success: true,
      message: "Shared capture is already stopped."
    });
    return;
  }

  sharedCaptureStopping = true;

  try {
    await sharedCapture.stop();

    res.json({
      success: true,
      message: "Shared capture stopped and finalized."
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    sharedCaptureStopping = false;
  }
});



// Storage monitoring is read-only. Never delete or stop recordings automatically.
app.get("/api/storage/health", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await mkdir(outputDirectory, { recursive: true });
    const stats = await statfs(outputDirectory, { bigint: true });
    const freeBytes = Number(stats.bavail * stats.bsize);
    const totalBytes = Number(stats.blocks * stats.bsize);
    const freeGiB = freeBytes / (1024 ** 3);
    res.json({
      status: freeGiB < STORAGE_CRITICAL_GIB ? "critical" : freeGiB < STORAGE_WARNING_GIB ? "warning" : "healthy",
      freeBytes, totalBytes, checkedAt: new Date().toISOString(),
      recordingDirectory: outputDirectory,
      thresholdsGiB: { warning: STORAGE_WARNING_GIB, critical: STORAGE_CRITICAL_GIB }
    });
  } catch (error) {
    res.status(503).json({ status: "unknown", error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "tournament-node",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/preview/status", (_req, res) => {
  res.json({
    available: false,
    transport: "pending",
    message: "Backend camera preview pipeline not started yet.",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/preview/test", (_req, res) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
      <rect width="640" height="360" fill="#111827"/>
      <rect x="20" y="20" width="600" height="320"
            rx="12" fill="none" stroke="#22c55e" stroke-width="3"/>
      <circle cx="320" cy="125" r="32" fill="#22c55e"/>
      <text x="320" y="205" text-anchor="middle"
            fill="white" font-family="Arial" font-size="28">
        Backend Preview Test
      </text>
      <text x="320" y="245" text-anchor="middle"
            fill="#9ca3af" font-family="Arial" font-size="18">
        Node.js API Connected
      </text>
    </svg>
  `;

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-store");
  res.send(svg);
});

app.get("/api/preview/frame", async (req, res) => {
  const cameraName = req.query.cameraName;

  if (typeof cameraName !== "string" || !cameraName.trim()) {
    res.status(400).json({
      error: "A cameraName query parameter is required."
    });
    return;
  }

  try {
    const frame = await capturePreviewFrame(cameraName);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(frame);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/preview/start", (req, res) => {
  const { cameraName } = req.body;

  if (typeof cameraName !== "string" || !cameraName.trim()) {
    res.status(400).json({ error: "cameraName is required." });
    return;
  }

  try {
    previewStream.start(cameraName);
    res.json({ success: true, cameraName });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/preview/latest", (_req, res) => {
  const frame = previewStream.getFrame();

  if (!frame) {
    res.status(404).json({ error: "No preview frame available." });
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(frame);
});

app.post("/api/preview/stop", (_req, res) => {
  previewStream.stop();
  res.json({ success: true });
});

// Timestamped node-side measurements collected only while cameras are recording.
const resourceHistoryTimer = setInterval(() => {
  const ids = cameraCaptureManager.list().map(c => c.cameraId);
  void sampleRecordingResources(ids);
}, 15_000);
resourceHistoryTimer.unref();
app.get("/api/system/resources/history", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const start = typeof req.query.start === "string" ? req.query.start : "";
  const end = typeof req.query.end === "string" ? req.query.end : "";
  const limit = Number(req.query.limit ?? 2000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
    return res.status(400).json({ error: "limit must be an integer between 1 and 5000" });
  try { return res.json({ readings: await getResourceHistory(start, end, limit), sampling: resourceSamplingStatus(),
    notes: ["Measurements are approximately every 15 seconds during active camera captures.",
      "Sampling timestamps are not exact failure timestamps; unavailable counters remain null.",
      "Disk activity and GPU utilization are system-wide, not per-camera or NVENC-specific."] }); }
  catch (error) { return res.status(400).json({ error: String(error) }); }
});
app.get("/api/system/resources", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await readSystemResources()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/usb/bandwidth-estimate", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const devices = await discoverDevices();
    const preferences = getSettings().devices;
    const cameras = devices.filter(device => device.kind === "video" &&
      preferences[device.id]?.hidden !== true);
    res.json(estimateUsbBandwidth(cameras));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/usb/diagnostics", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json({ checkedAt: new Date().toISOString(), ...(await listUsbVideoDevices()) }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await discoverDevices();

    const preferences = getSettings().devices;
    const decorated = devices.map(device => ({
      ...device,
      displayName: preferences[device.id]?.alias?.trim() || device.name,
      hidden: preferences[device.id]?.hidden === true,
      pairedMicrophoneId: preferences[device.id]?.pairedMicrophoneId ?? null
    }));
    res.json({
      cameras: decorated.filter(device => device.kind === "video" && !device.hidden),
      microphones: decorated.filter(device => device.kind === "audio" && !device.hidden),
      allDevices: decorated
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/recordings", (_req, res) => {
  res.json({
    recordings: recordingManager.getAllStatuses()
  });
});

app.get("/api/recordings/summary", (_req, res) => {
  const recordings = recordingManager.getAllStatuses();

  res.json({
    activeRecordings: recordings.length,
    isRecording: recordings.length > 0,
    recordings,
    timestamp: new Date().toISOString()
  });
});


app.get("/api/recordings/:cameraId", (req, res) => {
  const cameraId = String(req.params.cameraId);
  const session = recordingManager.getStatus(cameraId);

  if (!session) {
    res.status(404).json({
      error: `Camera ${cameraId} is not recording.`
    });
    return;
  }

  res.json(session);
});

app.post("/api/recordings/start", async (req, res) => {
  const { cameraId, cameraName, microphoneName } = req.body ?? {};

  if (
    typeof cameraId !== "string" ||
    typeof cameraName !== "string" ||
    typeof microphoneName !== "string" ||
    !cameraId.trim() ||
    !cameraName.trim() ||
    !microphoneName.trim()
  ) {
    res.status(400).json({
      error: "cameraId, cameraName and microphoneName are required."
    });
    return;
  }


  try {
    const devices = await discoverDevices();

    const cameraExists = devices.some(
      (device) =>
        device.kind === "video" &&
        device.name === cameraName
    );

    const microphoneExists = devices.some(
      (device) =>
        device.kind === "audio" &&
        device.name === microphoneName
    );

    if (!cameraExists) {
      res.status(400).json({
        error: `Camera not found: ${cameraName}`
      });
      return;
    }

    if (!microphoneExists) {
      res.status(400).json({
        error: `Microphone not found: ${microphoneName}`
      });
      return;
    }

    const session = await recordingManager.start(cameraId, {

      cameraName,
      microphoneName,
      outputDirectory,
      width: 1920,
      height: 1080,
      fps: 30
    });

    res.json({
      success: true,
      recording: true,
      session
    });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/recordings/:cameraId/stop", async (req, res) => {
  const cameraId = String(req.params.cameraId);

  try {
    await recordingManager.stop(cameraId);

    res.json({
      success: true,
      recording: false,
      cameraId
    });
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

const host = getNetworkBindAddress();
app.listen(PORT, host, () => {
  console.log("");
  console.log("Tournament Streaming API");
  console.log(`http://127.0.0.1:${PORT}`);
  console.log("");
});
