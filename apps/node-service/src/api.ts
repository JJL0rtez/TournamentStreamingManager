// @ts-ignore Native ESM coordination package has no TypeScript declarations.
import { inspectCoordinatorRings } from "../../../packages/capture-coordination/live-inspection.mjs";
import { CaptureStartReservations, type ActiveCaptureIdentity, type CaptureStartIdentity } from "./capture-start-reservations.js";
import { makeLiveOperationsSnapshot } from "./live-operations-snapshot.js";
// @ts-ignore ESM coordination module is tested by native Node tests.
import { createUnifiedLifecycle } from "../../../packages/capture-coordination/unified-lifecycle.mjs";
// @ts-ignore Standalone ESM coordination package is exercised by native Node tests.
import { evaluateOwnershipReadiness } from "../../../packages/capture-coordination/readiness.mjs";
import { competingCapturePath } from "./capture-path-guard.js";
import { EventEntitlementStore } from "./event-entitlement.js";
import { getUsbTopology, establishUsbTopologyBaseline, compareUsbTopologyBaseline } from "./usb-topology-service.js";
import { getStorageReadiness, getLastDiskBenchmark, diskBenchmarkRunning, startDiskBenchmark } from "./storage-readiness-service.js";
import { summarizeOutputInventory } from "./output-inventory.js";
import { evaluateOutputStart, summarizeOutputRoutes } from "./output-start-guard.js";
import { makeCapacityReport } from "./capacity-readiness.js";
import {installTournamentDisplays} from "./tournament-displays.js";
import {installSponsorMedia} from "./sponsor-media.js";
import {switchableRecordingEnabled} from "./switchable-recording.js";
import { installBillboardRoutes } from "./billboard-routes.js";
import { readVersionedRecoveryReliabilityRules, saveVersionedRecoveryReliabilityRules, ReliabilityRuleConflict, readRecoveryReliabilityRuleHistory, restoreRecoveryReliabilityRules } from "./recovery-reliability-rules.js";
import { readSharedWarnings, addSharedWarning, acknowledgeSharedWarning } from "./shared-recovery-warnings.js";
import { appendRecoveryAudit, readRecoveryAudit } from "./recovery-audit.js";
import { readIncidentResolutions, saveIncidentResolutions } from "./recovery-incidents.js";
import { readRecoveryAcknowledgements, saveRecoveryAcknowledgements, recoveryEventKey } from "./recovery-acknowledgements.js";
import { readRecoveryPolicy, saveRecoveryPolicy } from "./recovery-policy.js";
import { summarizeCameraReliability } from "./camera-reliability-summary.js";
import { readDiagnosticThresholds, saveDiagnosticThresholds } from "./diagnostic-thresholds.js";
import { productionRelayError } from "./relay-mode-policy.js";
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
import { evaluateRelayPreflight } from "./relay-preflight.js";
import { listYouTubeProfiles, getYouTubeKey, saveYouTubeProfile, deleteYouTubeProfile, importYouTubeProfiles } from "./youtube-profiles.js";
import { getSettings, saveSettings, exportBackup, getNetworkBindAddress } from "./persistent-settings.js";
import { getSession, setSession, recordingDirectory, listTournamentEvents, selectTournamentEvent } from "./tournament-session.js";

import { readRecoveryHistory, appendPersistentRecoveryEvent } from "./recovery-history.js";
import express from "express";
import crypto from "node:crypto";
import { acceptPlaybackObservation, getPlaybackObservation } from "./playback-observation.js";
import { authorizePlaybackObserver } from "./playback-observer-auth.js";
import { createPlatformHealthReader, createYouTubeTokenProvider } from "./youtube-platform-health.js";
import type { Server } from "node:http";
import path from "node:path";
import { mkdir, statfs } from "node:fs/promises";
import { loadRecordingDestination, validateRecordingDestination, persistRecordingDestination, listRecordingDirectories, listRecordingRoots } from "./recording-directory-config.js";
import { networkInterfaces } from "node:os";
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
import { CoordinatedYouTube } from "./coordinated-youtube.js";
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

// Observe fatal failures without suppressing normal Node exit semantics.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  console.error(`[Fatal Node service error: ${origin}]`, error instanceof Error ? error.name : "Error", (error as NodeJS.ErrnoException)?.code ?? "");
  // Avoid emitting credentials or request contents in fatal diagnostics.
});
const app = express();
app.use(express.json());
installOperatorAuth(app);
// Independent observer ingestion, protected by a distinct 32+ character secret.
// This route must precede the browser operator guard. It never mutates a stream.
app.post("/api/operations/playback-observation", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!authorizePlaybackObserver(req.body, req.get("x-playback-observer-token"))) {
    res.status(401).json({error: "Unauthorized observer"}); return;
  }
  if (!acceptPlaybackObservation(req.body)) { res.status(400).json({error: "Invalid or stale playback observation"}); return; }
  res.status(202).json({accepted: true});
});
// Protect remote proxy writes too. Node token alone must not grant browser write privileges.
app.use("/api", requireOperator);
// Opt-in distributed capture is intentionally restricted to individual shared-capture
// start/stop routes. Unsupported mutation paths fail closed instead of bypassing leases.
const distributedCaptureEnabled = process.env.TSM_DISTRIBUTED_CAPTURE === "1";
// Separate opt-in: never enable unattended FFmpeg restarts just by enabling distributed capture.
const distributedAutomaticRecoveryOptIn = process.env.TSM_DISTRIBUTED_AUTO_RECOVERY === "1";
// Relay ownership shares the same ring lease as its local capture, never a second lease.
// Opt in separately so existing deployments retain the conservative relay block.
const distributedYoutubeEnabled = distributedCaptureEnabled && process.env.TSM_DISTRIBUTED_YOUTUBE === "1";
const distributedRelayAutoRecoveryEnabled = distributedYoutubeEnabled && process.env.TSM_DISTRIBUTED_RELAY_AUTO_RECOVERY === "1";
type DistributedRingStatus = {
  ringKey: string;
  state: string;
  members: string[];
  leaseLost: boolean;
  pendingStarts: number;
  stopInProgress: boolean;
  requiresReconciliation: boolean;
  empty: boolean;
};
// The shared coordination implementation is native ESM. Keep its TypeScript
// boundary explicit so route handlers cannot accidentally treat member IDs as unknown.
type DistributedLifecycle = {
  status(): DistributedRingStatus[];
  hasMember(kind: "capture" | "recording" | "youtube", cameraId: string): boolean;
  start<T>(kind: "capture" | "recording" | "youtube", cameraId: string, startFn: () => Promise<T>): Promise<T>;
  stop<T>(kind: "capture" | "recording" | "youtube", cameraId: string, stopFn: () => Promise<T>): Promise<void>;
  changeOutput<T>(cameraId: string, changeFn: () => Promise<T>): Promise<T>;
  restart<T>(kind: "capture" | "recording" | "youtube", cameraId: string, restartFn: () => Promise<T>): Promise<T>;
};
const distributedCaptureLifecycle: DistributedLifecycle | null = distributedCaptureEnabled
  ? createUnifiedLifecycle({ getSession, onIncident: (incident: unknown) => console.error("Distributed capture ownership incident:", incident) }) as DistributedLifecycle
  : null;
// In experimental distributed mode, only individual shared capture starts/stops
// may mutate FFmpeg pipelines. Block other lifecycle entry points, including
// YouTube relay operations and the un-suffixed /session route.
const distributedAllowedMutations = new Set(["/api/captures/start", "/api/captures/distributed-start-all", "/api/captures/distributed-stop-all"]);
// Bulk relay operations remain blocked until they have equivalent lifecycle protection.
app.use("/api", (req, res, next) => {
  if (!distributedCaptureEnabled || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const path = req.path;
  const captureMutation = /^\/(captures|recordings|session|capture|recovery)(?:\/|$)/.test(path);
  const youtubeRelayMutation = /^\/youtube\/(?:start-all|stop-all|[^/]+\/(?:start|stop))$/.test(path);
  if (!captureMutation && !youtubeRelayMutation) return next();
  if (distributedAllowedMutations.has(`/api${path}`) || /^\/captures\/[^/]+\/(?:stop|recover)$/.test(path)
    || (switchableRecordingEnabled() && /^\/captures\/[^/]+\/recording$/.test(path))
    || (distributedYoutubeEnabled && (/^\/youtube\/[^/]+\/(?:start|stop)$/.test(path) || path === "/youtube/distributed-start-all" || path === "/youtube/distributed-stop-all" || /^\/youtube\/[^/]+\/distributed-restart$/.test(path)))) return next();
  res.status(409).json({code:"DISTRIBUTED_CAPTURE_UNSUPPORTED_OPERATION",error:"This operation is not supported while distributed capture ownership is enabled."});
});
app.get("/api/captures/distributed-ownership", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({enabled:distributedCaptureEnabled, scope:distributedYoutubeEnabled?"shared-capture-and-youtube":"shared-capture-only", youtubeEnabled:distributedYoutubeEnabled, rings:distributedCaptureLifecycle?.status() ?? []});
});
// Read-only reconciliation view. Never release a coordinator lease or terminate
// FFmpeg solely because a process is missing from the lifecycle's memory.
app.get("/api/captures/distributed-reconciliation", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const running = cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId);
  const rings = distributedCaptureLifecycle?.status() ?? [];
  const tracked = new Set(rings.flatMap((ring: {members:string[]}) => ring.members.filter(member => member.startsWith("capture:")).map(member => member.slice(8))));
  const untrackedRunning = running.filter(cameraId => !tracked.has(cameraId));
  const trackedNotRunning = [...tracked].filter(cameraId => !running.includes(cameraId));
  const uncertainRings = rings.filter((ring: {requiresReconciliation:boolean}) => ring.requiresReconciliation).map((ring: {ringKey:string}) => ring.ringKey);
  res.json({enabled:distributedCaptureEnabled, running, tracked:[...tracked], untrackedRunning, trackedNotRunning, uncertainRings, safeToEnable:distributedCaptureEnabled && untrackedRunning.length===0 && trackedNotRunning.length===0 && uncertainRings.length===0});
});
installRemoteNodeRoutes(app);
installBillboardRoutes(app);
installTournamentDisplays(app);
installSponsorMedia(app);

const recordingManager = new RecordingManager();
const captureStartReservations = new CaptureStartReservations();
function activeCaptureInputs(): ActiveCaptureIdentity[] {
  return [
    ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => ({
      path: "shared" as const, cameraId: item.cameraId, cameraName: item.cameraName,
      cameraDeviceId: item.cameraDeviceId, microphoneName: item.microphoneName,
    })),
    ...recordingManager.getAllStatuses().map(item => ({
      path: "legacy-recording" as const, cameraId: item.cameraId,
      cameraName: item.cameraName, microphoneName: item.microphoneName,
    })),
  ];
}
function reserveCaptureStart(path: "shared" | "legacy-recording", identity: CaptureStartIdentity): () => void {
  if (identity.microphoneName && activeAudioTests.has(identity.microphoneName)) throw new Error("Microphone already in use by an equipment test.");
  return captureStartReservations.reserve(path, identity, activeCaptureInputs());
}
function reserveCaptureRecovery(cameraId: string): () => void {
  const managed = cameraCaptureManager.get(cameraId);
  if (!managed?.capture.isRunning) throw new Error("Camera is not recording.");
  return captureStartReservations.reserveReplacement({
    cameraId: managed.cameraId, cameraName: managed.cameraName,
    cameraDeviceId: managed.cameraDeviceId, microphoneName: managed.microphoneName,
  }, activeCaptureInputs());
}

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
// Prevent a standalone relay retry after its UDP producer exits.
// Distributed ownership-aware restarts are handled independently below.
const youtubeStreams = new YouTubeStreamManager(cameraId => !distributedYoutubeEnabled && process.env.TSM_COORDINATE_YOUTUBE !== "1" && Boolean(cameraCaptureManager.get(cameraId)?.capture.isRunning));
// Explicit opt-in: existing single-node operation is unchanged unless configured.
// This coordinates YouTube relays only, not local recording/capture ownership.
const youtubeCoordinationEnabled = process.env.TSM_COORDINATE_YOUTUBE === "1";
// In shared-ring mode the unified lifecycle is the only lease authority.
// Never run the independent YouTube lease coordinator at the same time.
const coordinatedYoutube = youtubeCoordinationEnabled && !distributedYoutubeEnabled ? new CoordinatedYouTube(youtubeStreams) : null;
const startYoutubeRelay = async (cameraId: string, key: string): Promise<void> => {
  if (coordinatedYoutube) await coordinatedYoutube.start(cameraId, key);
  else await youtubeStreams.start(cameraId, key);
};
const stopYoutubeRelay = async (cameraId: string): Promise<boolean> => {
  if (coordinatedYoutube) return coordinatedYoutube.stop(cameraId);
  return youtubeStreams.stop(cameraId);
};
const stopAllYoutubeRelays = async (): Promise<void> => {
  if (coordinatedYoutube) await coordinatedYoutube.stopAll();
  else await youtubeStreams.stopAll();
};

// Resolve by DirectShow alternative ID, never by enumeration order. The same
// camera can have several identical-looking microphone names.
async function resolveMicrophone(cameraId: string, requestedName?: string, requestedId?: string): Promise<{ name: string; input: string }> {
  const devices = (await discoverDevices()).filter(device => device.kind === "audio");
  const savedId = getSettings().devices[cameraId]?.pairedMicrophoneId;
  const id = requestedId || devices.find(device => device.id === requestedName || device.alternativeName === requestedName)?.id || savedId;
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
const recordingLocationFile = path.resolve(currentDirectory, "../../../.tsm-recording-location.json");
let outputDirectory = loadRecordingDestination(recordingLocationFile,
  path.resolve(currentDirectory, "../../../recordings"));


// Event passes are verified offline. The issuer private key is never shipped.
const entitlementNodeId = process.env.TSM_NODE_ID ?? "";
const entitlementKey = process.env.TSM_LICENSE_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n") ?? "";
const entitlementStore = entitlementNodeId && entitlementKey
  ? new EventEntitlementStore(path.resolve(currentDirectory,"../../../.tsm-entitlement"),entitlementKey,entitlementNodeId)
  : null;
if(entitlementStore) void entitlementStore.load().catch(error => console.error("Entitlement load failed:",error));
const entitlementStatus = () => entitlementStore?.status() ?? {
  tier:"free" as const,reason:"ENTITLEMENT_NOT_CONFIGURED",licenseId:null,
  eventId:null,activatedAt:null,expiresAt:null,canStartNewCleanOutput:true,maxNodes:1
};
app.get("/api/entitlement/status",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({...entitlementStatus(),configured:Boolean(entitlementStore),
    enforcementEnabled:process.env.TSM_ENFORCE_FREE_PRODUCTION==="1"});
});
app.post("/api/entitlement/install",async(req,res)=>{
  if(!entitlementStore){res.status(503).json({error:"Set TSM_NODE_ID and TSM_LICENSE_PUBLIC_KEY_PEM"});return;}
  try{res.json(await entitlementStore.install(req.body));}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:String(error)});}
});
app.post("/api/entitlement/activate",async(_req,res)=>{
  if(!entitlementStore){res.status(503).json({error:"Entitlement not configured"});return;}
  try{res.json(await entitlementStore.activate());}
  catch(error){res.status(409).json({error:error instanceof Error?error.message:String(error)});}
});

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

// Read-only unified-ownership readiness. This endpoint never starts, stops, or leases FFmpeg.
app.get("/api/captures/ownership-readiness", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession();
  const activeCaptureIds = cameraCaptureManager.list().map(item => item.cameraId);
  const activeRecordingIds = recordingManager.getAllStatuses().map(item => item.cameraId);
  const activeRelayIds = youtubeStreams.list().map(item => item.cameraId);
  const assignments = session?.assignments ?? [];
  const assignedIds = new Set(assignments.map(item => item.cameraId));
  const activeIds = [...new Set([...activeCaptureIds, ...activeRecordingIds, ...activeRelayIds])];
  const missingAssignments = activeIds.filter(id => !assignedIds.has(id));
  const configured = Boolean(process.env.TSM_COORDINATOR_URL && (process.env.TSM_COORDINATOR_SECRET?.length ?? 0) >= 32 && process.env.TSM_NODE_ID);
  res.json({
    mode: "read-only", unifiedOwnershipEnabled: false, youtubeCoordinationEnabled,
    coordinatorConfigured: configured, sessionConfigured: Boolean(session),
    active: { captures: activeCaptureIds, recordings: activeRecordingIds, youtube: activeRelayIds },
    missingAssignments,
    blockers: [
      ...(!configured ? ["COORDINATOR_CONFIGURATION_REQUIRED"] : []),
      ...(!session ? ["TOURNAMENT_SESSION_REQUIRED"] : []),
      ...(missingAssignments.length ? ["ACTIVE_CAMERA_RING_ASSIGNMENT_MISSING"] : []),
      ...(activeIds.length ? ["ACTIVE_PIPELINES_MUST_BE_RECONCILED_BEFORE_ENABLING"] : []),
      "UNIFIED_API_LIFECYCLE_NOT_YET_ENABLED"
    ]
  });
});

// Batch 35: deeper read-only coordinator integration preflight. Does not claim a lease.
app.get("/api/captures/distributed-preflight", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const active = {
    captures: cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
    recordings: recordingManager.getAllStatuses().map(item => item.cameraId),
    youtube: youtubeStreams.list().map(item => item.cameraId),
  };
  const report = evaluateOwnershipReadiness({
    session: getSession(), nodeId: process.env.TSM_NODE_ID ?? "",
    coordinatorConfigured: Boolean(process.env.TSM_COORDINATOR_URL && (process.env.TSM_COORDINATOR_SECRET?.length ?? 0) >= 32),
    active, claims: coordinatedYoutube?.status() ?? [],
  });
  res.json({ ...report, unifiedOwnershipEnabled: false, liveCoordinatorVerified: false });
});

// Batch 36: bounded, authenticated, read-only coordinator inspection. Never mutates a lease.
app.get("/api/captures/coordinator-inspection", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const report = await inspectCoordinatorRings({
    session: getSession(), nodeId: process.env.TSM_NODE_ID,
    url: process.env.TSM_COORDINATOR_URL, secret: process.env.TSM_COORDINATOR_SECRET,
  });
  res.status(report.verified ? 200 : 503).json(report);
});

app.get("/api/youtube/coordination", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ enabled: youtubeCoordinationEnabled, scope: "youtube-relays-only",
    claims: coordinatedYoutube?.status() ?? [] });
});

app.get("/api/youtube/streams", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ streams: youtubeStreams.list() });
});

// Independent YouTube platform API metadata, separate from local relays and decoder observers.
let youtubeApiToken = "";
const youtubeTokenProvider = createYouTubeTokenProvider(() => ({
  accessToken: process.env.TSM_YOUTUBE_OAUTH_ACCESS_TOKEN,
  clientId: process.env.TSM_YOUTUBE_OAUTH_CLIENT_ID,
  clientSecret: process.env.TSM_YOUTUBE_OAUTH_CLIENT_SECRET,
  refreshToken: process.env.TSM_YOUTUBE_OAUTH_REFRESH_TOKEN
}));
const youtubePlatformHealth = createPlatformHealthReader(() => ({
  mapping: process.env.TSM_YOUTUBE_BROADCASTS_JSON,
  token: youtubeApiToken
}));
app.get("/api/operations/youtube-platform-health", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  youtubeApiToken = await youtubeTokenProvider();
  res.json(await youtubePlatformHealth());
});

app.get("/api/operations/playback-observation", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getPlaybackObservation());
});

// Read-only recovery telemetry. Does not disclose YouTube stream keys.
app.get("/api/operations/process-recovery", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ checkedAt: new Date().toISOString(),
    captures: { automaticEnabled: process.env.TOURNAMENT_CAPTURE_AUTO_RECOVER === "1", retries: cameraCaptureManager.recoveryStatus(), events: cameraCaptureManager.recoveryEventsSnapshot() },
    relays: { automaticEnabled: process.env.TOURNAMENT_RELAY_AUTO_RECOVER === "1", retries: youtubeStreams.recoveryStatus(), events: youtubeStreams.recoveryEventsSnapshot() },
    note: "Relay progress is local FFmpeg telemetry, not verified YouTube playback." });
});

// Operator-friendly consolidated local readiness, without mutation or stream credentials.
app.get("/api/operations/live-readiness", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession();
  const result = makeLiveOperationsSnapshot({
    eventId: session?.eventId, eventName: session?.eventName,
    assignments: session?.assignments ?? [],
    captures: cameraCaptureManager.list().map(item => ({
      cameraId: item.cameraId, running: item.capture.isRunning,
      recordingEnabled: item.recordingEnabled, outputMode: item.outputMode,
      frameAgeMs: item.capture.getFrameStats().frameAgeMs, recordingPath: item.recordingPath
    })),
    relays: youtubeStreams.list().map(item => ({ cameraId: item.cameraId,
      relayHealth: item.relayHealth, lastProgressAt: item.lastProgressAt })),
    captureRetries: cameraCaptureManager.recoveryStatus(),
    relayRetries: youtubeStreams.recoveryStatus()
  });
  res.json(result);
});

// Diagnostic endpoint is local relay telemetry only, never YouTube-side confirmation.
app.get("/api/youtube/:cameraId/relay-health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const stream = youtubeStreams.get(req.params.cameraId);
  res.json({ cameraId: req.params.cameraId, active: Boolean(stream),
    stream: stream ?? null, lastExit: youtubeStreams.lastExit(req.params.cameraId),
    youtubeVerified: false });
});

// Local-only preflight. Never includes saved keys or attempts a YouTube connection.
app.get("/api/youtube/:cameraId/preflight", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cameraId = req.params.cameraId;
  const capture = cameraCaptureManager.get(cameraId);
  let keyConfigured = false;
  let profileError: string | null = null;
  try { keyConfigured = Boolean(getYouTubeKey(cameraId)); }
  catch { profileError = "Saved YouTube profile is unavailable; check stream-key secret configuration."; }
  const result = evaluateRelayPreflight({
    cameraId,
    captureDevicePresent: Boolean(capture),
    captureRunning: Boolean(capture?.capture.isRunning),
    streamKeyConfigured: keyConfigured,
    relayActive: Boolean(youtubeStreams.get(cameraId)),
    otherCameraIds: cameraCaptureManager.list().map(item => item.cameraId)
  });
  res.json({ cameraId, ...result, profileError });
});

// Read-only output inventory. This reports actual capture modes, not licensing claims.
app.get("/api/output-mode/summary", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const captures = cameraCaptureManager.list().map(item => ({
    cameraId: item.cameraId,
    outputMode: item.outputMode,
    running: item.capture.isRunning,
    recordingEnabled: item.recordingEnabled,
    youtubeRelayActive: Boolean(youtubeStreams.get(item.cameraId)),
  }));
  try {
    const summary = summarizeOutputInventory(captures);
    res.json({
      ...summary,
      warning: summary.diagnosticStreaming.length
        ? "UNVERIFIED_DIAGNOSTIC_YOUTUBE_RELAY"
        : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error), code: "OUTPUT_INVENTORY_INVALID" });
  }
});

app.get("/api/output-mode/active-captures", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    captures: cameraCaptureManager.list().map(item => ({
      cameraId: item.cameraId,
      mode: item.outputMode,
      running: item.capture.isRunning,
      recordingEnabled: item.recordingEnabled,
      youtubeRelayActive: Boolean(youtubeStreams.get(item.cameraId)),
    })),
    diagnosticYoutubeRelayEnabled: false,
    localDiagnosticCaptureEnabled: process.env.TSM_ENABLE_LOCAL_DIAGNOSTICS === "1",
    freeProductionEnforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1",
  });
});

app.get("/api/output-mode/readiness", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(summarizeOutputRoutes({
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1",
    diagnosticWatermarkReady: process.env.TSM_ENABLE_LOCAL_DIAGNOSTICS === "1",
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
  }));
});

app.post("/api/youtube/:cameraId/start", async (req, res) => {
  // Central output boundary. Diagnostic requests cannot enter an unwatermarked production pipeline.
  const outputDecision = evaluateOutputStart({
    requestedMode: req.body?.mode,
    cameraIds: [req.params.cameraId],
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
  });
  if (!outputDecision.allowed) {
    res.status(outputDecision.status).json({ error: outputDecision.reason, code: outputDecision.code });
    return;
  }

  const cameraId = req.params.cameraId;
  if (rejectDuringSessionOperation(res)) return;
  if (previewBusy.has(cameraId)) { res.status(409).json({error:"Camera operation already in progress."}); return; }
  if (productionRelayError(cameraCaptureManager.get(cameraId))) {
    res.status(409).json({ code: "DIAGNOSTIC_RELAY_REQUIRES_VERIFICATION", error: "Diagnostic capture relay is disabled until end-to-end watermark verification is complete." });
    return;
  }
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
    res.status(409).json({ error: "Start a camera capture before connecting the YouTube relay." });
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
  if (distributedCaptureLifecycle) {
    if (!distributedYoutubeEnabled || !distributedCaptureLifecycle.hasMember("capture", cameraId)) {
      res.status(409).json({code:"DISTRIBUTED_RELAY_REQUIRES_OWNED_CAPTURE"});return;
    }
    if (youtubeStreams.get(cameraId)) {res.status(409).json({code:"RELAY_ALREADY_RUNNING"});return;}
  }
  try {
    if (distributedCaptureLifecycle) {
      await distributedCaptureLifecycle.start("youtube", cameraId, () => startYoutubeRelay(cameraId, effectiveKey));
    } else await startYoutubeRelay(cameraId, effectiveKey);
    res.json({ success: true, stream: youtubeStreams.get(cameraId) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not start relay." });
  }
});

// Batch 46: distributed bulk relay operations share the capture's ring lease.
// These routes deliberately do not start or stop the underlying recording.
app.post("/api/youtube/distributed-start-all", async (req, res) => {
  if (!distributedYoutubeEnabled || !distributedCaptureLifecycle) {
    res.status(409).json({code:"DISTRIBUTED_YOUTUBE_DISABLED"}); return;
  }
  const finish = beginSessionOperation("youtube-start-all");
  if (!finish) { res.status(409).json({code:"SESSION_OPERATION_BUSY"}); return; }
  try {
    const session = getSession();
    const assignments = session?.assignments ?? [];
    if (!assignments.length || assignments.length > 8 || new Set(assignments.map(a => a.cameraId)).size !== assignments.length) {
      res.status(409).json({code:"INVALID_DISTRIBUTED_ASSIGNMENTS"}); return;
    }
    const decision = evaluateOutputStart({
      requestedMode:req.body?.mode,
      cameraIds:assignments.map(a => a.cameraId),
      activeCameraIds:Array.from(new Set([
        ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
        ...recordingManager.getAllStatuses().map(item => item.cameraId),
      ])),
      enforcementEnabled:process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
    });
    if (!decision.allowed) {res.status(decision.status).json({code:decision.code,error:decision.reason});return;}
    const results: {cameraId:string;ok:boolean;error?:string}[] = [];
    for (const {cameraId} of assignments) {
      try {
        const capture = cameraCaptureManager.get(cameraId);
        if (!capture?.capture.isRunning || !distributedCaptureLifecycle.hasMember("capture",cameraId)) throw Error("DISTRIBUTED_RELAY_REQUIRES_OWNED_CAPTURE");
        if (productionRelayError(capture)) throw Error("DIAGNOSTIC_RELAY_REQUIRES_VERIFICATION");
        const already = youtubeStreams.get(cameraId);
        const tracked = distributedCaptureLifecycle.hasMember("youtube",cameraId);
        if (already || tracked) {
          if (!already || !tracked) throw Error("RELAY_MEMBERSHIP_MISMATCH");
          results.push({cameraId,ok:true}); continue;
        }
        const collision = cameraCaptureManager.list().find(other => other.cameraId !== cameraId && streamPort(other.cameraId) === streamPort(cameraId));
        if (collision) throw Error("CAMERA_TRANSPORT_PORT_COLLISION");
        const key = getYouTubeKey(cameraId);
        if (!key) throw Error("YOUTUBE_STREAM_KEY_MISSING");
        await distributedCaptureLifecycle.start("youtube",cameraId,() => startYoutubeRelay(cameraId,key));
        results.push({cameraId,ok:true});
      } catch(error) {results.push({cameraId,ok:false,error:error instanceof Error?error.message:String(error)});}
    }
    res.status(results.some(item=>!item.ok)?207:200).json({results});
  } finally {finish();}
});

app.post("/api/youtube/distributed-stop-all", async (_req,res) => {
  if (!distributedYoutubeEnabled || !distributedCaptureLifecycle) {
    res.status(409).json({code:"DISTRIBUTED_YOUTUBE_DISABLED"}); return;
  }
  const finish = beginSessionOperation("youtube-stop-all");
  if (!finish) {res.status(409).json({code:"SESSION_OPERATION_BUSY"});return;}
  try {
    // Include locally running untracked relays in the report, but never stop them.
    const assigned = (getSession()?.assignments ?? []).map(a=>a.cameraId);
    const running = youtubeStreams.list().map(item=>item.cameraId);
    const tracked = distributedCaptureLifecycle.status().flatMap(ring=>ring.members.filter(member=>member.startsWith("youtube:")).map(member=>member.slice(8)));
    const ids = [...new Set([...assigned,...running,...tracked])];
    const results: {cameraId:string;ok:boolean;error?:string}[] = [];
    for (const cameraId of ids) {
      try {
        const member = distributedCaptureLifecycle.hasMember("youtube",cameraId);
        const live = !!youtubeStreams.get(cameraId);
        if (!member && !live) {results.push({cameraId,ok:true});continue;}
        if (!member || !live) throw Error("RELAY_MEMBERSHIP_MISMATCH_REQUIRES_RECONCILIATION");
        await distributedCaptureLifecycle.stop("youtube",cameraId,async()=>{
          const stopped = await stopYoutubeRelay(cameraId);
          if (!stopped && youtubeStreams.get(cameraId)) throw Error("RELAY_STOP_UNCONFIRMED");
        });
        results.push({cameraId,ok:true});
      } catch(error) {results.push({cameraId,ok:false,error:error instanceof Error?error.message:String(error)});}
    }
    res.status(results.some(item=>!item.ok)?207:200).json({results});
  } finally {finish();}
});

// Batch 47: inspect relay ownership and process state without mutating FFmpeg or leases.
app.get("/api/youtube/distributed-reconciliation", (_req,res) => {
  res.setHeader("Cache-Control","no-store");
  if (!distributedYoutubeEnabled || !distributedCaptureLifecycle) {
    res.json({enabled:false, safe:false, relays:[], uncertainRings:[]}); return;
  }
  const rings = distributedCaptureLifecycle.status();
  const members = new Set(rings.flatMap(r => r.members.filter(m => m.startsWith("youtube:")).map(m => m.slice(8))));
  const running = new Set(youtubeStreams.list().map(item => item.cameraId));
  const relays = [...new Set([...members,...running])].sort().map(cameraId => {
    const tracked = members.has(cameraId);
    const active = running.has(cameraId);
    const capture = cameraCaptureManager.get(cameraId);
    const captureOwned = distributedCaptureLifecycle.hasMember("capture",cameraId) && !!capture?.capture.isRunning;
    const ring = rings.find(r => r.members.includes(`youtube:${cameraId}`));
    const ownershipReady = !!ring && ring.state === "active" && !ring.leaseLost && !ring.requiresReconciliation && !ring.stopInProgress && ring.pendingStarts === 0;
    const state = !tracked ? "untracked-running" : !captureOwned ? "capture-not-owned" : !ownershipReady ? "ownership-uncertain" : active ? "healthy-local" : "relay-exited";
    return {cameraId, tracked, active, captureOwned, ownershipReady, state, manualRestartEligible:state==="relay-exited"};
  });
  res.json({enabled:true, safe:relays.every(item=>item.state==="healthy-local"), relays,
    uncertainRings:rings.filter(r=>r.requiresReconciliation).map(r=>r.ringKey)});
});

// Explicit operator action only. Never stop a live relay or recording as a side effect.
// A failed restart retains ownership as uncertain for operator reconciliation.
const relayRecoveryAttempts = new Map<string, number[]>();
const relayRecoveryBusy = new Set<string>();
const RELAY_RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const RELAY_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const RELAY_RECOVERY_LIMIT = 2;

async function restartExitedDistributedRelay(cameraId: string): Promise<void> {
  if (!distributedYoutubeEnabled || !distributedCaptureLifecycle) throw Error("DISTRIBUTED_YOUTUBE_DISABLED");
  if (relayRecoveryBusy.has(cameraId)) throw Error("RELAY_RECOVERY_IN_PROGRESS");
  if (activeSessionOperation) throw Error("SESSION_OPERATION_BUSY");
  const now = Date.now();
  const attempts = (relayRecoveryAttempts.get(cameraId) ?? []).filter(t => now - t < RELAY_RECOVERY_WINDOW_MS);
  relayRecoveryAttempts.set(cameraId, attempts);
  if (attempts.length >= RELAY_RECOVERY_LIMIT) throw Error("RELAY_RECOVERY_LIMIT_REACHED");
  if (attempts.length && now - attempts[attempts.length - 1] < RELAY_RECOVERY_COOLDOWN_MS) throw Error("RELAY_RECOVERY_COOLDOWN");
  const finish = beginSessionOperation("youtube-relay-restart");
  if (!finish) throw Error("SESSION_OPERATION_BUSY");
  relayRecoveryBusy.add(cameraId);
  try {
    if (!distributedCaptureLifecycle.hasMember("youtube",cameraId)) throw Error("UNTRACKED_RELAY_REQUIRES_RECONCILIATION");
    if (youtubeStreams.get(cameraId)) throw Error("RELAY_STILL_RUNNING");
    const capture = cameraCaptureManager.get(cameraId);
    if (!capture?.capture.isRunning || !distributedCaptureLifecycle.hasMember("capture",cameraId)) throw Error("DISTRIBUTED_RELAY_REQUIRES_OWNED_CAPTURE");
    if (productionRelayError(capture)) throw Error("DIAGNOSTIC_RELAY_REQUIRES_VERIFICATION");
    const ring = distributedCaptureLifecycle.status().find(r=>r.members.includes(`youtube:${cameraId}`));
    if (!ring || ring.state !== "active" || ring.leaseLost || ring.requiresReconciliation || ring.stopInProgress || ring.pendingStarts !== 0) throw Error("RING_OWNERSHIP_UNCERTAIN");
    const collision = cameraCaptureManager.list().find(other=>other.cameraId !== cameraId && streamPort(other.cameraId)===streamPort(cameraId));
    if (collision) throw Error("CAMERA_TRANSPORT_PORT_COLLISION");
    const key = getYouTubeKey(cameraId);
    if (!key) throw Error("YOUTUBE_STREAM_KEY_MISSING");
    // Count attempted restarts before FFmpeg launch, including failed attempts.
    relayRecoveryAttempts.set(cameraId, [...attempts, Date.now()]);
    await distributedCaptureLifecycle.restart("youtube",cameraId,()=>startYoutubeRelay(cameraId,key));
    if (!youtubeStreams.get(cameraId)) throw Error("RELAY_RESTART_UNCONFIRMED");
  } finally {
    relayRecoveryBusy.delete(cameraId);
    finish();
  }
}

// Explicit operator action. Shares the same rate limits and safety checks as unattended recovery.
app.post("/api/youtube/:cameraId/distributed-restart", async (req,res) => {
  try {
    await restartExitedDistributedRelay(req.params.cameraId);
    res.json({success:true,cameraId:req.params.cameraId,relayActive:true});
  } catch(error) {
    res.status(409).json({code:"DISTRIBUTED_RELAY_RESTART_BLOCKED",error:error instanceof Error?error.message:String(error)});
  }
});

// Unattended relay recovery is a separate opt-in. Never stops an active relay,
// never restarts a recording, and never releases a ring lease.
let relayRecoverySweepBusy = false;
const relayRecoveryTimer = setInterval(async () => {
  if (!distributedRelayAutoRecoveryEnabled || relayRecoverySweepBusy || activeSessionOperation || !distributedCaptureLifecycle) return;
  relayRecoverySweepBusy = true;
  try {
    const rings = distributedCaptureLifecycle.status();
    for (const ring of rings) {
      if (activeSessionOperation) break;
      if (ring.state !== "active" || ring.leaseLost || ring.requiresReconciliation || ring.stopInProgress || ring.pendingStarts !== 0) continue;
      for (const member of ring.members) {
        if (!member.startsWith("youtube:")) continue;
        const cameraId = member.slice("youtube:".length);
        if (youtubeStreams.get(cameraId)) continue;
        try { await restartExitedDistributedRelay(cameraId); }
        catch (error) {
          // No keys or credentials are included in the diagnostic.
          console.warn("Distributed relay recovery skipped:", cameraId, error instanceof Error ? error.message : String(error));
        }
      }
    }
  } finally { relayRecoverySweepBusy = false; }
}, 30_000);
relayRecoveryTimer.unref?.();

// Bulk YouTube controls only operate on already-running local recordings.
// A failed relay does not stop its local recording or any other relay.
app.post("/api/youtube/start-all", async (_req, res) => {
  // Central output boundary. Diagnostic requests cannot enter an unwatermarked production pipeline.
  const outputDecision = evaluateOutputStart({
    requestedMode: _req.body?.mode,
    cameraIds: (getSession()?.assignments ?? []).map(a => a.cameraId),
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
  });
  if (!outputDecision.allowed) {
    res.status(outputDecision.status).json({ error: outputDecision.reason, code: outputDecision.code });
    return;
  }

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
      const relayModeError = productionRelayError(capture);
      if (relayModeError) throw new Error(relayModeError);
      if (youtubeStreams.get(cameraId)) {
        results.push({ cameraId, ok: true }); continue;
      }
      const collision = cameraCaptureManager.list().find(other =>
        other.cameraId !== cameraId && streamPort(other.cameraId) === streamPort(cameraId));
      if (collision) throw new Error("Camera transport port collision.");
      const key = getYouTubeKey(cameraId);
      if (!key) throw new Error("No saved YouTube stream key for this camera.");
      await startYoutubeRelay(cameraId, key);
      results.push({ cameraId, ok: true });
    } catch (error) {
      results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  res.status(results.some(r => !r.ok) ? 207 : 200).json({ results });
});

app.post("/api/youtube/stop-all", async (_req, res) => {
  try {
    await stopAllYoutubeRelays();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/youtube/:cameraId/stop", async (req, res) => {
  const cameraId = req.params.cameraId;
  if (distributedCaptureLifecycle && !distributedCaptureLifecycle.hasMember("youtube",cameraId)) {
    res.status(409).json({code:"UNTRACKED_RELAY_REQUIRES_MANUAL_RECOVERY"});return;
  }
  try {
    let stopped = false;
    if (distributedCaptureLifecycle) {
      await distributedCaptureLifecycle.stop("youtube",cameraId,async () => {
        stopped = await stopYoutubeRelay(cameraId);
        if (!stopped && youtubeStreams.get(cameraId)) throw Error("RELAY_STOP_UNCONFIRMED");
      });
    } else stopped = await stopYoutubeRelay(cameraId);
    res.json({ success: true, stopped });
  } catch (error) {
    res.status(409).json({code:"RELAY_STOP_UNCERTAIN",error:error instanceof Error?error.message:"Could not stop YouTube relay."});
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
      const configuredMicId = assignment.microphoneId || getSettings().devices[assignment.cameraId]?.pairedMicrophoneId;
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

// Configured count is not proof of verified USB/encoder/network capacity.
app.get("/api/session/capacity", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const assignments = getSession()?.assignments ?? [];
  res.json(makeCapacityReport(assignments));
});

app.get("/api/session/preflight", async (_req, res) => {
  await checkSessionPreflight(getSession(), res, "saved");
});

// Validate the editor's current unsaved assignments without modifying the
// persistent session, event ID, or saved templates.
app.post("/api/session/preflight", async (req, res) => {
  const input = req.body;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.eventName !== "string" || input.eventName.length > 200 ||
      !Array.isArray(input.assignments) ||
      !input.assignments.every((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const value = entry as Record<string, unknown>;
        return ["cameraId", "cameraName", "microphoneName", "ring"].every(key =>
          typeof value[key] === "string" && (value[key] as string).length <= 256);
      })) {
    res.status(400).json({ error: "Invalid draft session." });
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

// Serialize tournament-wide start/stop operations within this Node process.
// A conflicting request is rejected rather than waiting and acting on stale state.
// This is not a distributed lease and does not replace per-camera reservations.
type SessionOperationKind = "start-all" | "stop-all" | "youtube-start-all" | "youtube-stop-all" | "youtube-relay-restart";
let activeSessionOperation: SessionOperationKind | null = null;
function beginSessionOperation(kind: SessionOperationKind): (() => void) | null {
  if (activeSessionOperation) return null;
  activeSessionOperation = kind;
  let finished = false;
  return () => { if (!finished) { finished = true; activeSessionOperation = null; } };
}
// Block manual capture lifecycle mutations during tournament-wide operations.
// This is a process-local interlock, not a cross-PC distributed lease.
function rejectDuringSessionOperation(res: import("express").Response): boolean {
  if (!activeSessionOperation) return false;
  res.status(409).json({
    code: "SESSION_OPERATION_BUSY",
    error: `Tournament operation already in progress: ${activeSessionOperation}`,
    activeOperation: activeSessionOperation,
  });
  return true;
}
app.get("/api/session/operation", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ activeOperation: activeSessionOperation, processLocal: true });
});

// Each camera is started independently. Failures are reported per camera, not hidden.
app.post("/api/session/start-all", async (_req, res) => {
  const finishOperation = beginSessionOperation("start-all");
  if (!finishOperation) {
    res.status(409).json({ code: "SESSION_OPERATION_BUSY", error: `Tournament operation already in progress: ${activeSessionOperation}` });
    return;
  }
  try {
  // Central output boundary. Diagnostic requests cannot enter an unwatermarked production pipeline.
  const outputDecision = evaluateOutputStart({
    requestedMode: _req.body?.mode,
    cameraIds: (getSession()?.assignments ?? []).map(a => a.cameraId),
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
  });
  if (!outputDecision.allowed) {
    res.status(outputDecision.status).json({ error: outputDecision.reason, code: outputDecision.code });
    return;
  }

  const session = getSession();
  if (!session) { res.status(409).json({ error: "Configure a tournament session first." }); return; }
  // Optional all-or-nothing reservation of every not-yet-running input.
  // This is process-local and only reserves startup, not a cross-PC lease.
  // Keep legacy partial-success semantics unless explicitly requested.
  const atomicReservations = _req.body?.atomicReservations === true;
  let releaseBatch: (() => void) | undefined;
  const resolvedInputs = new Map<string, Awaited<ReturnType<typeof resolveMicrophone>>>();
  const inputErrors = new Map<string, string>();
  for (const a of session.assignments) {
    if (cameraCaptureManager.get(a.cameraId)?.capture.isRunning) continue;
    try { resolvedInputs.set(a.cameraId, await resolveMicrophone(a.cameraId, a.microphoneName, a.microphoneId)); }
    catch (error) { inputErrors.set(a.cameraId, error instanceof Error ? error.message : String(error)); }
  }
  if (atomicReservations && inputErrors.size) {
    res.status(409).json({code: "CAPTURE_INPUT_UNAVAILABLE", error: [...inputErrors.values()].join("; ")}); return;
  }
  if (atomicReservations) {
    const pendingAssignments = session.assignments.filter(a => !cameraCaptureManager.get(a.cameraId)?.capture.isRunning);
    const busy = pendingAssignments.find(a => previewBusy.has(a.cameraId));
    if (busy) {
      res.status(409).json({ code: "CAPTURE_INPUT_BUSY", error: `Camera operation already in progress: ${busy.cameraId}` });
      return;
    }
    try {
      if (pendingAssignments.some(a=>activeAudioTests.has(resolvedInputs.get(a.cameraId)!.input))) throw new Error("Microphone already in use by an equipment test.");
      releaseBatch = captureStartReservations.reserveBatch("shared", pendingAssignments.map(a => ({
        cameraId: a.cameraId, cameraName: a.cameraName,
        cameraDeviceId: a.cameraId, microphoneName: resolvedInputs.get(a.cameraId)!.input,
      })), activeCaptureInputs());
    } catch (error) {
      res.status(409).json({ code: "CAPTURE_INPUT_BUSY", error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }
  try {
  const results: { cameraId: string; ok: boolean; error?: string }[] = [];
  for (const assignment of session.assignments) {
    const { cameraId, cameraName, microphoneName } = assignment;
    const existing = cameraCaptureManager.get(cameraId);
    if (existing?.capture.isRunning) {
      if (existing.recordingEnabled) { results.push({ cameraId, ok: true }); continue; }
      try {
        if (previewBusy.has(cameraId)) throw new Error("Camera operation already in progress.");
        if (!existing.capture.supportsRecordingSwitch) throw new Error("Stop the stream before switching the legacy capture to recording.");
        await assertRecordingSpace();
        await cameraCaptureManager.changeRecording(cameraId, true, recordingDirectory(outputDirectory, cameraId));
        results.push({cameraId, ok:true});
      } catch (error) { results.push({cameraId,ok:false,error:error instanceof Error?error.message:String(error)}); }
      continue;
    }
    const mic = resolvedInputs.get(cameraId);
    if (!mic) { results.push({cameraId,ok:false,error:inputErrors.get(cameraId) || "Microphone unavailable"}); continue; }
    // A batch start must never abort the entire response after earlier cameras
    // have started. Report conflicts individually and continue with the rest.
    if (previewBusy.has(cameraId)) {
      results.push({ cameraId, ok: false, error: "Camera operation already in progress" });
      continue;
    }
    let releaseStart: (() => void) | undefined;
    if (!atomicReservations) {
      try {
        releaseStart = reserveCaptureStart("shared", {
          cameraId, cameraName, cameraDeviceId: cameraId, microphoneName: mic.input,
        });
      } catch (error) {
        results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    previewBusy.add(cameraId);
    const wasPreviewing = !!previewSessionManager.get(cameraId);
    try {
      if (wasPreviewing) await previewProcessManager.stop(cameraId);
      await assertRecordingSpace();
      await cameraCaptureManager.start(cameraId, cameraName, cameraId, mic.input,
        recordingDirectory(outputDirectory, cameraId));
      results.push({ cameraId, ok: true });
    } catch (error) {
      if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
        try { await previewProcessManager.start(cameraId); } catch { /* preview status reports failure */ }
      }
      results.push({ cameraId, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      previewBusy.delete(cameraId);
      releaseStart?.();
    }
  }
  res.status(results.some((item) => !item.ok) ? 207 : 200).json({ results, atomicReservations });
  } finally {
    releaseBatch?.();
  }
  } finally { finishOperation(); }
});

app.post("/api/session/stop-all", async (_req, res) => {
  const finishOperation = beginSessionOperation("stop-all");
  if (!finishOperation) {
    res.status(409).json({ code: "SESSION_OPERATION_BUSY", error: `Tournament operation already in progress: ${activeSessionOperation}` });
    return;
  }
  try {
  const results: { cameraId: string; ok: boolean; error?: string }[] = [];
  for (const managed of cameraCaptureManager.list()) {
    const cameraId = managed.cameraId;
    try {
      if (previewBusy.has(cameraId)) throw new Error("Camera operation already in progress.");
      if (_req.body?.recordingsOnly === true) {
        if (!managed.recordingEnabled) continue;
        const relayNeeded = Boolean(youtubeStreams.get(cameraId)) || youtubeStreams.recoveryStatus().some(r=>r.cameraId===cameraId&&r.pending);
        if (relayNeeded) {
          if (!managed.capture.supportsRecordingSwitch) throw new Error("This legacy capture is streaming; recording was left running to protect the broadcast.");
          await cameraCaptureManager.changeRecording(cameraId, false, recordingDirectory(outputDirectory,cameraId));
          results.push({cameraId,ok:true}); continue;
        }
      }
      await stopYoutubeRelay(cameraId);
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
  } finally { finishOperation(); }
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
    const recordingStart = item.recordingStartedAt ?? item.startedAt;
    const previous = recordingGrowth.get(item.cameraId);
    const growth = !previous || previous.startedAt !== recordingStart ||
      (bytes !== null && bytes > previous.bytes)
      ? { startedAt: recordingStart, bytes: bytes ?? 0, lastGrowthAt: now }
      : previous;
    if (item.recordingEnabled) recordingGrowth.set(item.cameraId, growth);
    else recordingGrowth.delete(item.cameraId);
    const ageMs = Math.max(0, now - new Date(item.startedAt).getTime());
    const warnings: string[] = [];
    if (ageMs > 15000) {
      if (stats.frameAgeMs === null || stats.frameAgeMs > 5000)
        warnings.push("No recent video frames (over 5 seconds).");
      if (item.recordingEnabled && now - Date.parse(recordingStart) > 15000) {
        if (bytes === null) warnings.push("Recording file size is unavailable.");
        else if (now - growth.lastGrowthAt > 15000) warnings.push("Recording file has not grown for over 15 seconds.");
      }
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
let recoveryPolicy = readRecoveryPolicy();
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_MAX_PER_HOUR = 2;
const recoveryAttempts = new Map<string, number[]>();
const recoveringCaptures = new Set<string>();
const unhealthySamples = new Map<string, number>();
const recoveryMessages = new Map<string, string>();
const recoveryEvents = readRecoveryHistory();
let recoveryAcknowledgements = readRecoveryAcknowledgements();
let incidentResolutions = readIncidentResolutions();
function appendRecoveryEvent(cameraId: string, outcome: "success" | "failure", detail: string): void {
  const event = { cameraId, at: new Date().toISOString(), outcome, detail };
  recoveryEvents.push(event);
  if (recoveryEvents.length > 100) recoveryEvents.shift();
  appendPersistentRecoveryEvent(event);
  try {
    const previous = incidentResolutions[cameraId];
    if (outcome === "failure" && previous && Date.parse(previous.lastFailureAt) < Date.parse(event.at)) {
      appendRecoveryAudit({ type: "reopened", cameraId, at: event.at, detail: "New failed recovery after operator resolution" });
      // Delete stale resolution to avoid duplicate reopen events.
      const next = { ...incidentResolutions }; delete next[cameraId];
      saveIncidentResolutions(next); incidentResolutions = next;
    }
    appendRecoveryAudit({ type: outcome === "failure" ? "failure" : "success", cameraId, at: event.at, detail });
  } catch (error) { console.error("Recovery audit persistence failed:", error); }
}
function hasActiveYoutubeRelay(cameraId: string): boolean {
  return youtubeStreams.list().some(stream => stream.cameraId === cameraId);
}
function distributedRecoveryReady(cameraId: string): boolean {
  if (!distributedCaptureLifecycle) return true;
  if (!distributedCaptureLifecycle.hasMember("capture", cameraId)) return false;
  const matching = distributedCaptureLifecycle.status().filter(ring => ring.members.includes(`capture:${cameraId}`));
  return matching.length === 1 && matching[0].state === "active" && !matching[0].leaseLost &&
    !matching[0].stopInProgress && matching[0].pendingStarts === 0 && !matching[0].requiresReconciliation;
}
function recoveryEligibility(cameraId: string): { allowed: boolean; reason?: string } {
  // Distributed ownership must never be bypassed by the legacy stop/start recovery path.
  // Keep the running recording untouched until a lease-preserving restart is implemented.
  if (recoveringCaptures.has(cameraId) || previewBusy.has(cameraId)) return { allowed: false, reason: "Camera operation in progress" };
  // Read-only preflight: a pending start or another active input may own the
  // physical camera. Do not stop a recording unless replacement can reserve it.
  try { const release = reserveCaptureRecovery(cameraId); release(); }
  catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : String(error) }; }
  if (hasActiveYoutubeRelay(cameraId)) return { allowed: false, reason: "Active YouTube stream: stop streaming before restarting capture" };
  if (!cameraCaptureManager.get(cameraId)?.capture.isRunning) return { allowed: false, reason: "No active capture to restart" };
  if (distributedCaptureLifecycle && !distributedRecoveryReady(cameraId)) return { allowed: false, reason: "DISTRIBUTED_RING_NOT_READY_FOR_RECOVERY" };
  const now = Date.now();
  const attempts = (recoveryAttempts.get(cameraId) ?? []).filter(t => now - t < RECOVERY_WINDOW_MS);
  recoveryAttempts.set(cameraId, attempts);
  if (attempts.length >= RECOVERY_MAX_PER_HOUR) return { allowed: false, reason: "Recovery limit reached (2 per hour)" };
  if (attempts.length && now - attempts[attempts.length - 1] < RECOVERY_COOLDOWN_MS)
    return { allowed: false, reason: "Recovery cooldown active (5 minutes)" };
  return { allowed: true };
}
async function recoverCapture(cameraId: string): Promise<string> {
  // Recheck inside the mutation path as well as the read-only eligibility path.
  const eligibility = recoveryEligibility(cameraId);
  if (!eligibility.allowed) throw new Error(eligibility.reason);
  const managed = cameraCaptureManager.get(cameraId);
  if (!managed?.capture.isRunning) throw new Error("Camera is not recording.");
  // Hold a physical-input reservation throughout stop and replacement start.
  // If it cannot be obtained, the existing recording is left untouched.
  const releaseRecovery = reserveCaptureRecovery(cameraId);
  recoveringCaptures.add(cameraId);
  previewBusy.add(cameraId);
  recoveryAttempts.set(cameraId, [...(recoveryAttempts.get(cameraId) ?? []), Date.now()]);
  const wasPreviewing = !!previewSessionManager.get(cameraId);
  try {
    // Do not terminate an audience-facing stream as a side effect of recovery.
    if (hasActiveYoutubeRelay(cameraId)) throw new Error("Active YouTube stream: recovery cancelled");
    const wasRecording = managed.recordingEnabled;
    const restartPipeline = async () => {
      await cameraCaptureManager.stop(cameraId);
      recordingGrowth.delete(cameraId);
      const mic = await resolveMicrophone(cameraId, managed.microphoneName);
      return cameraCaptureManager.start(cameraId, managed.cameraName, managed.cameraDeviceId,
        mic.input, recordingDirectory(outputDirectory, cameraId), wasRecording, managed.outputMode);
    };
    const restarted = distributedCaptureLifecycle
      ? await distributedCaptureLifecycle.restart("capture", cameraId, restartPipeline)
      : await restartPipeline();
    const message = wasRecording
      ? `Capture restarted. New recording: ${restarted.recordingPath}. Streaming remains stopped.`
      : "Capture restarted with local recording still disabled. Streaming remains stopped.";
    appendRecoveryEvent(cameraId, "success", message);
    recoveryMessages.set(cameraId, message);
    return message;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recoveryMessages.set(cameraId, `Recovery failed: ${message}`);
    appendRecoveryEvent(cameraId, "failure", message);
    if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
      try { await previewProcessManager.start(cameraId); } catch { /* keep original failure */ }
    }
    throw error;
  } finally {
    previewBusy.delete(cameraId);
    recoveringCaptures.delete(cameraId);
    releaseRecovery();
  }
}
app.get("/api/captures/recovery-policy", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...recoveryPolicy, effectiveEnabled: recoveryPolicy.enabled && (!distributedCaptureLifecycle || distributedAutomaticRecoveryOptIn), distributedBlocked: !!distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn });
});
app.put("/api/captures/recovery-policy", (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.enabled !== "boolean" ||
      !Number.isInteger(body.unhealthyChecks) || Number(body.unhealthyChecks) < 3 || Number(body.unhealthyChecks) > 12 ||
      !Number.isInteger(body.minimumCaptureAgeSeconds) || Number(body.minimumCaptureAgeSeconds) < 30 || Number(body.minimumCaptureAgeSeconds) > 600) {
    res.status(400).json({ error: "Invalid policy. Checks must be 3-12 and capture age 30-600 seconds." });
    return;
  }
  if (distributedCaptureLifecycle && body.enabled && !distributedAutomaticRecoveryOptIn) {
    res.status(409).json({ code: "DISTRIBUTED_RECOVERY_REQUIRES_LEASE_AWARE_RESTART", error: "Automatic recovery cannot be enabled in distributed capture mode." });
    return;
  }
  const next = { enabled: body.enabled, unhealthyChecks: Number(body.unhealthyChecks),
    minimumCaptureAgeSeconds: Number(body.minimumCaptureAgeSeconds), protectedStreams: true as const };
  try {
    saveRecoveryPolicy(next);
    recoveryPolicy = next;
    unhealthySamples.clear();
    res.json(recoveryPolicy);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get("/api/captures/recovery-status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ automaticEnabled: recoveryPolicy.enabled && (!distributedCaptureLifecycle || distributedAutomaticRecoveryOptIn), configuredEnabled: recoveryPolicy.enabled, distributedBlocked: !!distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn, cooldownMinutes: 5, maxAttemptsPerHour: 2,
    cameras: cameraCaptureManager.list().map(item => ({ cameraId: item.cameraId,
      ...recoveryEligibility(item.cameraId),
      attemptsInLastHour: (recoveryAttempts.get(item.cameraId) ?? []).filter(t => Date.now() - t < RECOVERY_WINDOW_MS).length,
      cooldownRemainingMs: Math.max(0, RECOVERY_COOLDOWN_MS - (Date.now() - ((recoveryAttempts.get(item.cameraId) ?? []).at(-1) ?? 0))),
      streaming: hasActiveYoutubeRelay(item.cameraId),
      restarting: recoveringCaptures.has(item.cameraId),
      recordingEnabled: item.recordingEnabled,
      lastResult: recoveryMessages.get(item.cameraId) ?? null })) });
});
app.get("/api/captures/recovery-events", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ events: recoveryEvents.slice().reverse().map(event => ({ ...event, acknowledgedAt: recoveryAcknowledgements[recoveryEventKey(event)] ?? null })) });
});
// Step 122: read-only persistent operator audit timeline.
// Shared warning thresholds are informational; changing them cannot restart captures.
app.get("/api/captures/reliability-rules", async (_req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await readVersionedRecoveryReliabilityRules()); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
app.get("/api/captures/reliability-rules/history", async (_req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json({ changes: await readRecoveryReliabilityRuleHistory() }); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
app.put("/api/captures/reliability-rules", async (req, res) => {
  try { res.json(await saveVersionedRecoveryReliabilityRules(req.body?.rules, req.body?.version, typeof req.headers["x-operator-note"] === "string" ? decodeURIComponent(req.headers["x-operator-note"]) : "")); }
  catch (error) { if (error instanceof ReliabilityRuleConflict) res.status(409).json({ error: error.message, ...error.current }); else res.status(400).json({ error: String(error) }); }
});
app.post("/api/captures/reliability-rules/restore", async (req, res) => {
  try { res.json(await restoreRecoveryReliabilityRules(req.body?.changeId, req.body?.snapshot, req.body?.version)); }
  catch (error) { if (error instanceof ReliabilityRuleConflict) res.status(409).json({ error: error.message, ...error.current }); else res.status(400).json({ error: String(error) }); }
});
// Shared, persistent recovery warning transitions and operator reviews.
app.get("/api/captures/reliability-warnings", async (_req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json({ events: await readSharedWarnings() }); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
app.post("/api/captures/reliability-warnings", async (req, res) => {
  try { const event = await addSharedWarning(req.body); res.status(201).json({ event }); }
  catch (error) { res.status(400).json({ error: String(error) }); }
});
app.post("/api/captures/reliability-warnings/acknowledge", async (req, res) => {
  try { const event = await acknowledgeSharedWarning(req.body?.key, req.body?.note); res.json({ event }); }
  catch (error) { res.status(400).json({ error: String(error) }); }
});
app.get("/api/captures/recovery-audit", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ events: readRecoveryAudit().slice().reverse() });
});
// Step 120: read-only repeated-failure escalation. No automated restart is triggered.
// Uses the persisted, bounded recovery audit log so escalation survives backend restarts.
app.get("/api/captures/recovery-escalations", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const threshold = 3;
  const grouped = new Map<string, typeof recoveryEvents>();
  for (const event of recoveryEvents) {
    if (event.outcome !== "failure") continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at > now || now - at > windowMs) continue;
    const entries = grouped.get(event.cameraId) ?? [];
    entries.push(event);
    grouped.set(event.cameraId, entries);
  }
  const escalations = [...grouped.entries()].filter(([, entries]) => entries.length >= threshold)
    .map(([cameraId, entries]) => ({
      cameraId, severity: "critical" as const, failuresInWindow: entries.length,
      firstFailureAt: entries[0].at, lastFailureAt: entries[entries.length - 1].at,
      unacknowledgedFailures: entries.filter(event => !recoveryAcknowledgements[recoveryEventKey(event)]).length,
      latestDetail: entries[entries.length - 1].detail,
      incidentStatus: incidentResolutions[cameraId] && Date.parse(incidentResolutions[cameraId].lastFailureAt) >= Date.parse(entries[entries.length - 1].at) ? "resolved" as const : "open" as const,
      resolvedAt: incidentResolutions[cameraId]?.resolvedAt ?? null,
      resolutionNote: incidentResolutions[cameraId]?.note ?? null
    })).sort((a, b) => b.failuresInWindow - a.failuresInWindow);
  res.json({ checkedAt: new Date(now).toISOString(), windowMinutes: 60, threshold, escalations });
});
// Resolution is administrative. A later failure reopens the incident automatically.
app.post("/api/captures/recovery-incidents/:cameraId/resolve", (req, res) => {
  const cameraId = req.params.cameraId;
  const note = (req.body as { note?: unknown } | undefined)?.note;
  if (typeof note !== "string" || !note.trim() || note.length > 500) {
    res.status(400).json({ error: "A resolution note of 1-500 characters is required." }); return;
  }
  const now = Date.now();
  const failures = recoveryEvents.filter(event => event.cameraId === cameraId && event.outcome === "failure" &&
    Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) <= now && now - Date.parse(event.at) <= 3600000);
  if (failures.length < 3) { res.status(409).json({ error: "Camera has no current critical escalation." }); return; }
  const lastFailureAt = failures[failures.length - 1].at;
  const resolution = { lastFailureAt, resolvedAt: new Date().toISOString(), note: note.trim() };
  try {
    const next = { ...incidentResolutions, [cameraId]: resolution };
    saveIncidentResolutions(next);
    incidentResolutions = next;
    try { appendRecoveryAudit({ type: "resolved", cameraId, at: resolution.resolvedAt, detail: resolution.note }); }
    catch (error) { console.error("Recovery resolution audit write failed:", error); }
    res.json({ cameraId, incidentStatus: "resolved", ...resolution });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
// Only failures already present in the audit log can be acknowledged.
app.post("/api/captures/recovery-events/acknowledge", (req, res) => {
  const keys = (req.body as { keys?: unknown } | undefined)?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || !keys.every(key => typeof key === "string" && key.length < 500)) {
    res.status(400).json({ error: "Provide 1-100 recovery event keys." }); return;
  }
  const failures = new Set(recoveryEvents.filter(event => event.outcome === "failure").map(recoveryEventKey));
  if (keys.some(key => !failures.has(key))) { res.status(404).json({ error: "One or more recovery failures were not found." }); return; }
  const updated = { ...recoveryAcknowledgements };
  const timestamp = new Date().toISOString();
  const newlyAcknowledged = keys.filter(key => !updated[key]);
  for (const key of keys) updated[key] ??= timestamp;
  // Keep acknowledgements only for retained audit events.
  const retained = new Set(recoveryEvents.map(recoveryEventKey));
  for (const key of Object.keys(updated)) if (!retained.has(key)) delete updated[key];
  try {
    saveRecoveryAcknowledgements(updated); recoveryAcknowledgements = updated;
    for (const key of newlyAcknowledged) {
      const event = recoveryEvents.find(item => recoveryEventKey(item) === key);
      if (event) { try { appendRecoveryAudit({ type: "acknowledged", cameraId: event.cameraId, at: timestamp, detail: `Failure at ${event.at} acknowledged` }); }
        catch (error) { console.error("Recovery acknowledgement audit write failed:", error); } }
    }
    res.json({ success: true, acknowledged: keys.length });
  }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/captures/:cameraId/recover", async (req, res) => {
  if (rejectDuringSessionOperation(res)) return;
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
setInterval(async () => {
    if (!recoveryPolicy.enabled || (distributedCaptureLifecycle && !distributedAutomaticRecoveryOptIn)) return;
    if (watchdogBusy) return;
    watchdogBusy = true;
    try {
      const now = Date.now();
      const active = cameraCaptureManager.list().filter(item => item.capture.isRunning);
      const activeIds = new Set(active.map(item => item.cameraId));
      for (const id of unhealthySamples.keys()) if (!activeIds.has(id)) unhealthySamples.delete(id);
      for (const item of active) {
        const age = now - new Date(item.startedAt).getTime();
        if (age < recoveryPolicy.minimumCaptureAgeSeconds * 1000) { unhealthySamples.delete(item.cameraId); continue; }
        const stats = item.capture.getFrameStats();
        const size = await item.capture.getRecordingFileSize().catch(() => null);
        const previous = recordingGrowth.get(item.cameraId);
        const stalled = (stats.frameAgeMs === null || stats.frameAgeMs > 10000) &&
          (size === null || (!!previous && now - previous.lastGrowthAt > 20000));
        const samples = stalled ? (unhealthySamples.get(item.cameraId) ?? 0) + 1 : 0;
        unhealthySamples.set(item.cameraId, samples);
        if (samples < recoveryPolicy.unhealthyChecks || !recoveryEligibility(item.cameraId).allowed) continue;
        // Fail closed if the lease expires between watchdog sampling and restart.
        if (distributedCaptureLifecycle && !distributedRecoveryReady(item.cameraId)) continue;
        // Active streams must never be terminated by the unattended watchdog.
        if (youtubeStreams.list().some(stream => stream.cameraId === item.cameraId)) continue;
        unhealthySamples.set(item.cameraId, 0);
        try { await recoverCapture(item.cameraId); }
        catch (error) { console.error("Automatic recovery failed:", item.cameraId, error); }
      }
    } catch (error) { console.error("Recovery watchdog error:", error); }
    finally { watchdogBusy = false; }
  }, 10000);

// Probe a connected, idle camera only. DirectShow probing can fail when the
// camera is already opened by another process.
app.get("/api/cameras/:cameraId/capabilities", async (req, res) => {
  // Prevent two independent FFmpeg capture paths from using the same physical camera.
  const competingShared = competingCapturePath("legacy-recording", Boolean(cameraCaptureManager.get(req.params.cameraId)?.capture.isRunning), false);
  if (competingShared) {
    res.status(409).json({ code: competingShared, error: "Shared capture is already active for this camera. Stop it before starting a separate recording." });
    return;
  }

  try {
    const devices = await discoverDevices();
    const camera = devices.find(d => d.kind === "video" && d.id === req.params.cameraId);
    if (!camera) { res.status(404).json({ error: "Camera not found." }); return; }
    if (cameraCaptureManager.get(camera.id)) {
      res.status(409).json({ error: "Stop recording before probing camera modes." }); return;
    }
    const result = await probeCameraCapabilities(camera.alternativeName || camera.name);
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

// Step 105: passive local signal diagnostics, using existing camera captures.
// This endpoint does not verify the YouTube viewer-side playback.
app.get("/api/captures/signal-diagnostics", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ checkedAt: new Date().toISOString(), scope: "local-capture",
    captures: cameraCaptureManager.list().map(item => ({
      cameraId: item.cameraId, cameraName: item.cameraName,
      ...item.capture.getSignalDiagnostics()
    })) });
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
      recordingEnabled: managed.recordingEnabled,
      recordingSwitchSupported: managed.capture.supportsRecordingSwitch,
      outputMode: managed.outputMode,
      selectedMode: managed.selectedMode ?? null,
      configuredQuality: managed.configuredQuality ?? null,
      running: managed.capture.isRunning,
      startedAt: managed.recordingStartedAt ?? managed.startedAt,
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


// Diagnostics only: never exposes stream keys or starts/stops FFmpeg.
app.get("/api/captures/start-reservations", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ active: activeCaptureInputs(), pending: captureStartReservations.snapshot(), scope: "node-process" });
});

app.post("/api/captures/start", async (req, res) => {
  if (rejectDuringSessionOperation(res)) return;
  // Central output boundary. Diagnostic requests cannot enter an unwatermarked production pipeline.
  const outputDecision = evaluateOutputStart({
    requestedMode: req.body?.mode,
    diagnosticCaptureAllowed: process.env.TSM_ENABLE_LOCAL_DIAGNOSTICS === "1",
    cameraIds: [req.body?.cameraId],
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
  });
  if (!outputDecision.allowed) {
    res.status(outputDecision.status).json({ error: outputDecision.reason, code: outputDecision.code });
    return;
  }

  const { cameraId, cameraName, cameraDeviceId, microphoneName, microphoneId } = req.body ?? {};
  // The diagnostic capture is a local watermarked recording. YouTube relay is
  // separately blocked by the existing relay-mode policy.
  const existingCapture = typeof cameraId === "string" ? cameraCaptureManager.get(cameraId) : undefined;
  const recordingEnabled = req.body?.recordingEnabled !== false;
  if (req.body?.recordingEnabled !== undefined && typeof req.body.recordingEnabled !== "boolean") {
    res.status(400).json({error: "recordingEnabled must be a boolean."}); return;
  }
  const requestedCaptureMode = req.body?.mode === "diagnostic" ? "diagnostic" : "production";
  // The output-start guard rejects unknown modes before reaching this branch.
  // A running diagnostic capture must never be restarted as a clean production
  // capture by omitting mode. Reject both direction changes until explicitly stopped.
  if (existingCapture?.capture.isRunning && existingCapture.outputMode !== requestedCaptureMode) {
    res.status(409).json({error:"Stop the existing capture before changing its output mode.",code:"CAPTURE_MODE_TRANSITION_REQUIRES_STOP"});
    return;
  }

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

  // Do not launch a shared capture while the legacy recording path owns this camera.
  const competingLegacy = competingCapturePath("shared", false, Boolean(recordingManager.getStatus(cameraId)));
  if (competingLegacy) {
    res.status(409).json({ code: competingLegacy, error: "A separate recording is already active for this camera. Stop it before starting shared capture." });
    return;
  }

  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  let releaseStart: () => void;
  let resolvedMic: Awaited<ReturnType<typeof resolveMicrophone>>;
  try {
    resolvedMic = await resolveMicrophone(cameraId, microphoneName, microphoneId);
    if (previewBusy.has(cameraId) || rejectDuringSessionOperation(res)) {
      if (!res.headersSent) res.status(409).json({error: "Camera operation already in progress."});
      return;
    }
    releaseStart = reserveCaptureStart("shared", { cameraId, cameraName, cameraDeviceId, microphoneName: resolvedMic.input });
  }
  catch (error) {
    res.status(409).json({ code: "CAPTURE_INPUT_BUSY", error: error instanceof Error ? error.message : String(error) }); return;
  }
  previewBusy.add(cameraId);
  const wasPreviewing = !!previewSessionManager.get(cameraId);
  try {
    if (wasPreviewing) await previewProcessManager.stop(cameraId);
    if (recordingEnabled) await assertRecordingSpace();
    const managed = await (distributedCaptureLifecycle ? distributedCaptureLifecycle.start("capture", cameraId, () => cameraCaptureManager.start(
  cameraId,
  cameraName,
  cameraDeviceId,
  resolvedMic.input,
  recordingDirectory(outputDirectory, cameraId),
  recordingEnabled,
  requestedCaptureMode
    )) : cameraCaptureManager.start(cameraId, cameraName, cameraDeviceId, resolvedMic.input, recordingDirectory(outputDirectory, cameraId), recordingEnabled, requestedCaptureMode));

    res.json({
      success: true,
      cameraId: managed.cameraId,
      cameraName: managed.cameraName,
      microphoneName: managed.microphoneName,
      recordingPath: managed.recordingPath,
      recordingEnabled: managed.recordingEnabled,
      outputMode: managed.outputMode,
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
    releaseStart();
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
      previewFrozen: stats.frameAgeMs !== null && stats.frameAgeMs > 3000,
      error: shared ? null : previewProcessManager.getStats(session.cameraId).error
    };
  });
  res.json({ count: previews.length, previews });
});

// Explicit, operator-triggered device tests. Never interrupt live recordings.
const activeAudioTests = new Set<string>();
app.post("/api/device-test", async (req, res) => {
  const { cameraId, microphoneName, microphoneId } = req.body ?? {};
  if (typeof cameraId !== "string" || !cameraId ||
      typeof microphoneName !== "string" || !microphoneName) {
    res.status(400).json({ error: "cameraId and microphoneName are required." }); return;
  }
  // Prevent two independent FFmpeg capture paths from using the same physical camera.
  const competingShared = competingCapturePath("legacy-recording", Boolean(cameraCaptureManager.get(cameraId)?.capture.isRunning), false);
  if (competingShared) {
    res.status(409).json({ code: competingShared, error: "Shared capture is already active for this camera. Stop it before starting a separate recording." });
    return;
  }

  try {
    const devices = await discoverDevices();
    const camera = devices.find(d => d.kind === "video" && d.id === cameraId);
    const matchingMics = devices.filter(d => d.kind === "audio" && (microphoneId ? d.id === microphoneId : d.name === microphoneName));
    if (!camera || matchingMics.length !== 1) {
      res.status(400).json({ error: !camera ? "Camera is disconnected." :
        "Microphone is disconnected or its name is ambiguous. Assign a unique microphone device." }); return;
    }
    const micInput = matchingMics[0].alternativeName || matchingMics[0].name;
    if (activeAudioTests.has(micInput)) { res.status(409).json({error:"This microphone is already being tested."}); return; }
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
    const microphoneBusy = [...activeCaptureInputs(), ...captureStartReservations.snapshot()].some(c => c.microphoneName === micInput || c.microphoneName === matchingMics[0].name);
    if (microphoneBusy) {
      res.json({ cameraId, microphoneName, video,
        audio: { status: "busy", meanDb: null, maxDb: null,
          message: "Microphone is in use by a recording. Stop it before testing the audio level." },
        checkedAt: new Date().toISOString() }); return;
    }
    activeAudioTests.add(micInput);
    try {
      const audio = await testMicrophoneLevel(micInput);
      res.json({ cameraId, microphoneName, video, audio, checkedAt: new Date().toISOString() });
    } finally { activeAudioTests.delete(micInput); }
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
  // Do not launch a shared capture while the legacy recording path owns this camera.
  const competingLegacy = competingCapturePath("shared", false, Boolean(recordingManager.getStatus(cameraId)));
  if (competingLegacy) {
    res.status(409).json({ code: competingLegacy, error: "A separate recording is already active for this camera. Stop it before starting shared capture." });
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
    if (existing && (cameraCaptureManager.get(cameraId)?.capture.isRunning || previewProcessManager.isRunning(cameraId))) {
      res.json({ success: true, preview: existing });
      return;
    }
    if (existing) { await previewProcessManager.stop(cameraId); previewSessionManager.stop(cameraId); }
    const preview = previewSessionManager.start(cameraId, cameraName);
    const recording = cameraCaptureManager.get(cameraId);
    if (!recording?.capture.isRunning) {
      await previewProcessManager.start(cameraId);
    }
    previewSessionManager.setStatus(cameraId, "running");
    res.json({ success: true, preview });
  } catch (error) {
    try { await previewProcessManager.stop(cameraId); previewSessionManager.stop(cameraId); }
    catch (cleanupError) { console.warn("Preview cleanup incomplete:", cleanupError); previewSessionManager.setStatus(cameraId, "error"); }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    previewBusy.delete(cameraId);
  }
});

app.post("/api/previews/:cameraId/stop", async (req, res) => {
  const cameraId = req.params.cameraId;
  // Do not launch a shared capture while the legacy recording path owns this camera.
  const competingLegacy = competingCapturePath("shared", false, Boolean(recordingManager.getStatus(cameraId)));
  if (competingLegacy) {
    res.status(409).json({ code: competingLegacy, error: "A separate recording is already active for this camera. Stop it before starting shared capture." });
    return;
  }

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
  } catch (error) {
    res.status(409).json({error: error instanceof Error ? error.message : String(error)});
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

// Presentation is a passive consumer: never start a physical camera here.
app.get("/api/display-sources", (_req, res) => {
  const ids = new Set<string>();
  for (const item of cameraCaptureManager.list()) if (item.capture.isRunning) ids.add(item.cameraId);
  for (const item of previewSessionManager.list()) if (previewProcessManager.isRunning(item.cameraId)) ids.add(item.cameraId);
  res.setHeader("Cache-Control", "no-store");
  res.json({ cameraIds: [...ids].filter(id => {
    const capture = cameraCaptureManager.get(id);
    const stats = capture?.capture.isRunning ? capture.capture.getFrameStats() : previewProcessManager.getStats(id);
    return stats.frameAgeMs !== null && stats.frameAgeMs <= 8000 && previewFrame(id) !== null;
  }) });
});
app.get("/api/display-frame/:cameraId", (req, res) => {
  const id = req.params.cameraId;
  if (!cameraCaptureManager.get(id)?.capture.isRunning && !previewProcessManager.isRunning(id)) {
    res.status(404).json({ error: "No active camera feed." }); return;
  }
  const frame = previewFrame(id);
  if (!frame) { res.status(404).json({ error: "No frame available." }); return; }
  res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "no-store"); res.send(frame);
});

// Continuous multipart JPEG feed. Reuses the existing capture/preview process,
// so it never opens a second DirectShow handle for an active camera.
app.get("/api/display-live/:cameraId", (req, res) => {
  const cameraId = String(req.params.cameraId);
  const running = cameraCaptureManager.get(cameraId);
  if (!(running?.capture.isRunning || previewProcessManager.isRunning(cameraId))) {
    res.status(404).json({ error: "Camera is not capturing or previewing." }); return;
  }
  res.status(200);
  res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=frame");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let previous: Buffer | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || res.destroyed || res.writableEnded) { cleanup(); return; }
    const capture = cameraCaptureManager.get(cameraId);
    if (!capture?.capture.isRunning && !previewProcessManager.isRunning(cameraId)) { cleanup(); return; }
    if (res.writableNeedDrain) return; // Drop stale frames rather than buffer indefinitely.
    const frame = capture?.capture.isRunning ? capture.capture.getFrame() : previewFrame(cameraId);
    if (!frame || (previous && previous.equals(frame))) return;
    previous = frame;
    try {
      res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`), frame, Buffer.from("\r\n")]));
    } catch { cleanup(); }
  }, 100);
  function cleanup() { if (stopped) return; stopped = true; clearInterval(timer); if (!res.destroyed) res.end(); }
  res.on("close", cleanup);
  res.on("error", cleanup);
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

// Experimental distributed bulk operations. Each camera has an independent lease
// and a per-camera result. These routes do not start or stop YouTube relays.
// Existing session bulk endpoints remain disabled while distributed mode is on.
app.post("/api/captures/distributed-start-all", async (req, res) => {
  if (!distributedCaptureLifecycle) {
    res.status(409).json({code:"DISTRIBUTED_CAPTURE_DISABLED"}); return;
  }
  const finish = beginSessionOperation("start-all");
  if (!finish) { res.status(409).json({code:"SESSION_OPERATION_BUSY"}); return; }
  try {
    const session = getSession();
    if (!session) { res.status(409).json({code:"TOURNAMENT_SESSION_REQUIRED"}); return; }
    const assignments = session.assignments;
    if (assignments.length === 0 || assignments.length > 8 || new Set(assignments.map(a => a.cameraId)).size !== assignments.length) {
      res.status(409).json({code:"INVALID_DISTRIBUTED_ASSIGNMENTS"}); return;
    }
    const mode = req.body?.mode === "diagnostic" ? "diagnostic" : "production";
    const decision = evaluateOutputStart({
      requestedMode:req.body?.mode,
      cameraIds:assignments.map(a => a.cameraId),
      activeCameraIds:Array.from(new Set([
        ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
        ...recordingManager.getAllStatuses().map(item => item.cameraId),
      ])),
      enforcementEnabled:process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
    });
    if (!decision.allowed) { res.status(decision.status).json({code:decision.code,error:decision.reason}); return; }
    const results: {cameraId:string;ok:boolean;error?:string}[] = [];
    for (const assignment of assignments) {
      const {cameraId,cameraName,microphoneName} = assignment;
      const existing = cameraCaptureManager.get(cameraId);
      if (existing?.capture.isRunning) {
        if (!distributedCaptureLifecycle.hasMember("capture",cameraId)) {results.push({cameraId,ok:false,error:"UNTRACKED_RUNNING_CAPTURE"});continue;}
        if (existing.recordingEnabled) {results.push({cameraId,ok:true});continue;}
        try {
          if (!switchableRecordingEnabled() || !existing.capture.supportsRecordingSwitch || previewBusy.has(cameraId)) throw Error("Independent recording is unavailable for this capture.");
          await assertRecordingSpace();
          await distributedCaptureLifecycle.changeOutput(cameraId,()=>cameraCaptureManager.changeRecording(cameraId,true,recordingDirectory(outputDirectory,cameraId)));
          results.push({cameraId,ok:true});
        } catch(error) {results.push({cameraId,ok:false,error:error instanceof Error?error.message:String(error)});}
        continue;
      }
      if (distributedCaptureLifecycle.hasMember("capture",cameraId)) {
        results.push({cameraId,ok:false,error:"TRACKED_CAPTURE_NOT_RUNNING_REQUIRES_RECONCILIATION"}); continue;
      }
      if (recordingManager.getStatus(cameraId) || previewBusy.has(cameraId)) {
        results.push({cameraId,ok:false,error:"CAPTURE_INPUT_BUSY"}); continue;
      }
      let release: (() => void) | undefined;
      let mic: Awaited<ReturnType<typeof resolveMicrophone>>;
      try {
        mic = await resolveMicrophone(cameraId,microphoneName,assignment.microphoneId);
        if (previewBusy.has(cameraId)) throw new Error("Camera operation already in progress.");
        release = reserveCaptureStart("shared",{cameraId,cameraName,cameraDeviceId:cameraId,microphoneName:mic.input});
      } catch (error) {
        results.push({cameraId,ok:false,error:error instanceof Error ? error.message : String(error)}); continue;
      }
      previewBusy.add(cameraId);
      const wasPreviewing = Boolean(previewSessionManager.get(cameraId));
      try {
        if (wasPreviewing) await previewProcessManager.stop(cameraId);
        await assertRecordingSpace();
        await distributedCaptureLifecycle.start("capture",cameraId,() => cameraCaptureManager.start(
          cameraId,cameraName,cameraId,mic.input,recordingDirectory(outputDirectory,cameraId),true,mode));
        results.push({cameraId,ok:true});
      } catch (error) {
        if (wasPreviewing && !cameraCaptureManager.get(cameraId)) {
          try {await previewProcessManager.start(cameraId);} catch { /* report via preview status */ }
        }
        results.push({cameraId,ok:false,error:error instanceof Error ? error.message : String(error)});
      } finally {previewBusy.delete(cameraId);release?.();}
    }
    res.status(results.some(item=>!item.ok)?207:200).json({results,distributed:true});
  } finally {finish();}
});

app.post("/api/captures/distributed-stop-all", async (_req,res) => {
  if (!distributedCaptureLifecycle) {res.status(409).json({code:"DISTRIBUTED_CAPTURE_DISABLED"});return;}
  const finish = beginSessionOperation("stop-all");
  if (!finish) {res.status(409).json({code:"SESSION_OPERATION_BUSY"});return;}
  try {
    const results: {cameraId:string;ok:boolean;error?:string}[] = [];
    for (const managed of cameraCaptureManager.list()) {
      const cameraId = managed.cameraId;
      if (!distributedCaptureLifecycle.hasMember("capture",cameraId)) {
        results.push({cameraId,ok:false,error:"UNTRACKED_PIPELINE_REQUIRES_MANUAL_RECOVERY"});continue;
      }
      if (_req.body?.recordingsOnly === true && !managed.recordingEnabled) {results.push({cameraId,ok:true});continue;}
      if (youtubeStreams.get(cameraId) || distributedCaptureLifecycle.hasMember("youtube",cameraId)) {
        if (_req.body?.recordingsOnly === true && switchableRecordingEnabled() && managed.capture.supportsRecordingSwitch && !previewBusy.has(cameraId)) {
          try {
            await distributedCaptureLifecycle.changeOutput(cameraId,()=>cameraCaptureManager.changeRecording(cameraId,false,recordingDirectory(outputDirectory,cameraId)));
            results.push({cameraId,ok:true});
          } catch(error) {results.push({cameraId,ok:false,error:error instanceof Error?error.message:String(error)});}
        } else results.push({cameraId,ok:false,error:"STOP_YOUTUBE_RELAY_FIRST"});
        continue;
      }
      if (previewBusy.has(cameraId)) {results.push({cameraId,ok:false,error:"CAPTURE_INPUT_BUSY"});continue;}
      previewBusy.add(cameraId);
      try {
        await distributedCaptureLifecycle.stop("capture",cameraId,() => cameraCaptureManager.stop(cameraId));
        if (previewSessionManager.get(cameraId)) {
          try {await previewProcessManager.start(cameraId);} catch { /* preview can restart manually */ }
        }
        results.push({cameraId,ok:true});
      } catch (error) {
        results.push({cameraId,ok:false,error:error instanceof Error ? error.message : String(error)});
      } finally {previewBusy.delete(cameraId);}
    }
    res.status(results.some(item=>!item.ok)?207:200).json({results,distributed:true});
  } finally {finish();}
});

app.post("/api/captures/stop-all", async (_req, res) => {
  const finishOperation = beginSessionOperation("stop-all");
  if (!finishOperation) {
    res.status(409).json({ code: "SESSION_OPERATION_BUSY", error: `Tournament operation already in progress: ${activeSessionOperation}` });
    return;
  }
  try {
    const count = cameraCaptureManager.list().length;

    await stopAllYoutubeRelays();
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
  } finally { finishOperation(); }
});

app.post("/api/captures/:cameraId/recording", async (req, res) => {
  if (rejectDuringSessionOperation(res)) return;
  const cameraId = req.params.cameraId;
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") { res.status(400).json({error:"Recording state must be a boolean."}); return; }
  if ((distributedCaptureLifecycle && !switchableRecordingEnabled()) || previewBusy.has(cameraId)) {
    res.status(409).json({error:"Recording change unavailable while another camera operation is active."}); return;
  }
  const managed = cameraCaptureManager.get(cameraId);
  if (!managed?.capture.isRunning || !managed.capture.supportsRecordingSwitch) {
    res.status(409).json({error:"This camera does not support independent recording changes."}); return;
  }
  previewBusy.add(cameraId);
  try {
    if (enabled && !managed.recordingEnabled) {
      const decision = evaluateOutputStart({requestedMode:"production",cameraIds:[cameraId],
        activeCameraIds:cameraCaptureManager.list().filter(c=>c.capture.isRunning).map(c=>c.cameraId),
        enforcementEnabled:process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event"});
      if (!decision.allowed) {res.status(decision.status).json({error:decision.reason,code:decision.code});return;}
      await assertRecordingSpace();
    }
    const change = () => cameraCaptureManager.changeRecording(cameraId, enabled, recordingDirectory(outputDirectory,cameraId));
    if (distributedCaptureLifecycle) await distributedCaptureLifecycle.changeOutput(cameraId, change);
    else await change();
    res.json({success:true, cameraId, recordingEnabled:managed.recordingEnabled, captureRunning:managed.capture.isRunning});
  } catch (error) { res.status(409).json({error:error instanceof Error?error.message:String(error)}); }
  finally {previewBusy.delete(cameraId);}
});

app.post("/api/captures/:cameraId/stop", async (req, res) => {
  if (rejectDuringSessionOperation(res)) return;
  const cameraId = req.params.cameraId;
  if (req.body?.onlyIfIdle === true && (cameraCaptureManager.get(cameraId)?.recordingEnabled ||
      youtubeStreams.get(cameraId) || youtubeStreams.recoveryStatus().some(r=>r.cameraId===cameraId && r.pending))) {
    res.json({success:true, cameraId, skipped:true, message:"Camera still supplies another active output."}); return;
  }
  if (req.body?.recordingsOnly === true && (youtubeStreams.get(cameraId) || youtubeStreams.recoveryStatus().some(r=>r.cameraId===cameraId && r.pending))) {
    res.status(409).json({error:"Capture was left running to protect the active stream."}); return;
  }
  // Do not launch a shared capture while the legacy recording path owns this camera.
  const competingLegacy = competingCapturePath("shared", false, Boolean(recordingManager.getStatus(cameraId)));
  if (competingLegacy) {
    res.status(409).json({ code: competingLegacy, error: "A separate recording is already active for this camera. Stop it before starting shared capture." });
    return;
  }

  if (previewBusy.has(cameraId)) {
    res.status(409).json({ error: "Preview operation already in progress." });
    return;
  }
  // Do not stop a YouTube relay until we know this process tracks the capture.
  // An untracked stop must not mutate another pipeline as a side effect.
  if (distributedCaptureLifecycle && !distributedCaptureLifecycle.hasMember("capture", cameraId)) {
    res.status(409).json({code:"UNTRACKED_PIPELINE_REQUIRES_MANUAL_RECOVERY",error:"Capture is not tracked by this node's distributed lifecycle."});
    return;
  }
  if (distributedCaptureLifecycle && (youtubeStreams.get(cameraId) || distributedCaptureLifecycle.hasMember("youtube",cameraId))) {
    res.status(409).json({code:"STOP_YOUTUBE_RELAY_FIRST",error:"Stop the owned YouTube relay before stopping its capture."});return;
  }
  previewBusy.add(cameraId);
  try {
    // Distributed mode disallows relay mutations. In particular, never stop a
    // relay before the coordinator has accepted the capture stop transition.
    // Standalone mode retains the existing relay-first behaviour.
    if (distributedCaptureLifecycle) {
      await distributedCaptureLifecycle.stop("capture", cameraId, () => cameraCaptureManager.stop(cameraId));
    } else {
      await stopYoutubeRelay(cameraId);
      await cameraCaptureManager.stop(cameraId);
    }
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



// Local operator-selected recording directory. Do not change paths under active capture.
app.get("/api/storage/location", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({directory: outputDirectory});
});
app.get("/api/storage/drives", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({drives: await listRecordingRoots()});
});
app.get("/api/storage/directories", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try { res.json(await listRecordingDirectories(req.query.path)); }
  catch(error) { res.status(400).json({error: error instanceof Error ? error.message : String(error)}); }
});
app.put("/api/storage/location", async (req, res) => {
  if (activeSessionOperation || previewBusy.size || captureStartReservations.snapshot().length || cameraCaptureManager.list().length || recordingManager.getAllStatuses().length ||
      youtubeStreams.list().length || diskBenchmarkRunning()) {
    res.status(409).json({error: "Stop all recordings, streams and storage tests before changing the recording directory."}); return;
  }
  try {
    const directory = await validateRecordingDestination(req.body?.directory);
    // Validate the destination before persisting; never relocate existing recordings.
    await statfs(directory);
    persistRecordingDestination(recordingLocationFile, directory);
    outputDirectory = directory;
    res.setHeader("Cache-Control", "no-store");
    res.json({directory, changed: true});
  } catch(error) { res.status(400).json({error: error instanceof Error ? error.message : String(error)}); }
});

// Recording-disk readiness is opt-in and bounded. The benchmark writes a temporary
// file in the actual recording directory, fsyncs it, and deletes it in finally.
app.get("/api/storage/readiness", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await mkdir(outputDirectory,{recursive:true});
    const num=(key:string) => typeof req.query[key]==="string" ? Number(req.query[key]) : undefined;
    const report=await getStorageReadiness(outputDirectory,{
      cameras:num("cameras"), recordingMbpsPerCamera:num("recordingMbpsPerCamera"),
      streamMbpsPerCamera:num("streamMbpsPerCamera"), hours:num("hours"),
      safetyFactor:num("safetyFactor")
    });
    res.json(report);
  } catch(error) { res.status(400).json({error:error instanceof Error ? error.message : String(error)}); }
});
app.get("/api/storage/benchmark", (_req,res) => {
  res.setHeader("Cache-Control","no-store");
  res.json({running:diskBenchmarkRunning(),latest:getLastDiskBenchmark()});
});
app.post("/api/storage/benchmark", async (req,res) => {
  try {
    const sampleMiB=req.body?.sampleMiB===undefined ? 64 : Number(req.body.sampleMiB);
    if(!Number.isInteger(sampleMiB) || sampleMiB<16 || sampleMiB>256) {
      res.status(400).json({error:"sampleMiB must be an integer between 16 and 256"}); return;
    }
    if(diskBenchmarkRunning()) { res.status(409).json({error:"Disk benchmark already running"}); return; }
    const result=await startDiskBenchmark(outputDirectory,sampleMiB);
    res.json(result);
  } catch(error) { res.status(503).json({error:error instanceof Error ? error.message : String(error)}); }
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
  void sampleRecordingResources(ids).catch(error => console.warn("Resource sample failed:", error));
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

// Physical USB topology discovery; observational only, never auto-assign cameras.
app.post("/api/usb/topology/baseline", async (_req,res) => {
  try {res.json(await establishUsbTopologyBaseline());}
  catch(error) {res.status(503).json({error:String(error)});}
});
app.get("/api/usb/topology/changes", async (_req,res) => {
  try {res.json(await compareUsbTopologyBaseline());}
  catch(error) {res.status(503).json({error:String(error)});}
});

app.get("/api/usb/topology", async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  try {
    const report=await getUsbTopology(req.query.refresh==="1");
    res.json(report);
  } catch(error) {
    res.status(503).json({
      error:error instanceof Error?error.message:String(error),
      code:"USB_TOPOLOGY_DISCOVERY_FAILED"
    });
  }
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
  if (rejectDuringSessionOperation(res)) return;
  // Central output boundary. Diagnostic requests cannot enter an unwatermarked production pipeline.
  const outputDecision = evaluateOutputStart({
    requestedMode: req.body?.mode,
    cameraIds: [req.body?.cameraId],
    activeCameraIds: Array.from(new Set([
      ...cameraCaptureManager.list().filter(item => item.capture.isRunning).map(item => item.cameraId),
      ...recordingManager.getAllStatuses().map(item => item.cameraId),
    ])),
    enforcementEnabled: process.env.TSM_ENFORCE_FREE_PRODUCTION === "1" && entitlementStatus().tier !== "event",
  });
  if (!outputDecision.allowed) {
    res.status(outputDecision.status).json({ error: outputDecision.reason, code: outputDecision.code });
    return;
  }

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


  // Prevent two independent FFmpeg capture paths from using the same physical camera.
  const competingShared = competingCapturePath("legacy-recording", Boolean(cameraCaptureManager.get(cameraId)?.capture.isRunning), false);
  if (competingShared) {
    res.status(409).json({ code: competingShared, error: "Shared capture is already active for this camera. Stop it before starting a separate recording." });
    return;
  }

  let releaseStart: () => void;
  try { releaseStart = reserveCaptureStart("legacy-recording", { cameraId, cameraName, microphoneName }); }
  catch (error) { res.status(409).json({ code: "CAPTURE_INPUT_BUSY", error: error instanceof Error ? error.message : String(error) }); return; }
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
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  } finally { releaseStart(); }
});

app.post("/api/recordings/:cameraId/stop", async (req, res) => {
  if (rejectDuringSessionOperation(res)) return;
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

// The loopback listener is never dependent on Tailscale or LAN configuration.
// Remote binding is a second, optional listener on the same application.
type RemoteListenerStatus = { state: "disabled" | "listening" | "unavailable" | "starting"; address: string | null; message: string };
let remoteListenerStatus: RemoteListenerStatus = { state: "disabled", address: null, message: "Remote access is disabled." };
// This endpoint reports the listener's actual runtime state, not merely saved settings.
app.get("/api/network/status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ local: { available: true, address: `127.0.0.1:${PORT}` }, remote: remoteListenerStatus });
});
let remoteServer: Server | null = null;
const localServer = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Network] Local API listening: http://127.0.0.1:${PORT}`);
  startOptionalRemoteListener();
});
localServer.on("error", error => {
  console.error("[Network] Local API listener failed:", error);
});

function startOptionalRemoteListener(): void {
  let address: string;
  try { address = getNetworkBindAddress(); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    remoteListenerStatus = { state: "unavailable", address: null, message: reason };
    console.warn(`[Network] Remote access unavailable: ${reason}`);
    console.info("[Network] Local dashboard remains available.");
    return;
  }
  if (address === "127.0.0.1") {
    remoteListenerStatus = { state: "disabled", address: null, message: "Remote access is disabled in settings." };
    return;
  }
  if ((process.env.TOURNAMENT_ADMIN_PASSWORD || "").length < 12) {
    const message = "Set TOURNAMENT_ADMIN_PASSWORD to at least 12 characters before enabling remote access.";
    remoteListenerStatus = { state: "unavailable", address, message };
    console.warn(`[Network] Remote access unavailable: ${message}`);
    console.info("[Network] Local dashboard remains available.");
    return;
  }
  const available = Object.values(networkInterfaces()).flat().some(iface => iface?.address === address);
  if (!available) {
    const message = `Network interface ${address} is not available on this computer.`;
    remoteListenerStatus = { state: "unavailable", address, message };
    console.warn(`[Network] Remote access unavailable: ${message}`);
    console.info("[Network] Local dashboard remains available.");
    return;
  }
  try {
    remoteListenerStatus = { state: "starting", address, message: "Starting remote listener." };
    const server = app.listen(PORT, address);
    remoteServer = server;
    server.on("listening", () => {
      remoteListenerStatus = { state: "listening", address, message: `Remote API listening on ${address}:${PORT}.` };
      console.log(`[Network] Remote API: http://${address}:${PORT}`);
    });
    server.on("error", error => {
      const message = error instanceof Error ? error.message : String(error);
      remoteListenerStatus = { state: "unavailable", address, message };
      console.warn(`[Network] Remote listener unavailable: ${message}`);
      console.info("[Network] Local dashboard remains available.");
      if (remoteServer === server) remoteServer = null;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    remoteListenerStatus = { state: "unavailable", address, message };
    console.warn(`[Network] Remote listener unavailable: ${message}`);
    console.info("[Network] Local dashboard remains available.");
  }
}
