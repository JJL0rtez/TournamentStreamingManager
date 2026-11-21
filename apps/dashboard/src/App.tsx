import { CameraPreviewImage } from "./CameraPreviewImage";
import { startPolling } from "./operator-polling";
import { operatorApi } from "./operator-api";
import { OperatorNavigation, OperatorErrorNotice, type OperatorView } from "./OperatorNavigation";
import { chooseMicrophone } from "./microphone-identity";
import { OperationsAlertHistory, type OperationsAlertInput, type OperationsAlertSeverity, type OperationsAlertRecord } from "./OperationsAlertHistory";
import { ProcessRecoveryPanel } from "./ProcessRecoveryPanel";
import { LiveOperationsPanel } from "./LiveOperationsPanel";
import { FleetOperationsPanel } from "./FleetOperationsPanel";
import { PlaybackObservationPanel } from "./PlaybackObservationPanel";
import { YouTubePlatformHealthPanel } from "./YouTubePlatformHealthPanel";
import { DistributedOwnershipPanel } from "./DistributedOwnershipPanel";
import { DistributedRemoteControls } from "./DistributedRemoteControls";
import { FleetReadinessPanel } from "./FleetReadinessPanel";
import "./OperatorTools.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { GlobalNotifications } from "./GlobalNotifications";
import { EventPassPanel } from "./EventPassPanel";
import { HardwareReadinessPanel } from "./HardwareReadinessPanel";
import { type AppSettings, type Capture, type CaptureHealth, type DeviceList, type DevicePreference, type EncoderStatsSnapshot, type EquipmentTestResult, type MediaDevice, type NetworkStatus, type NodeInfo, type PreflightResult, type Preview, type RecordingEvent, type RecordingSummary, type SessionAssignment, type SizeHistory, type StorageHealth, type StressResourceReport, type StressResult, type StressSnapshot, type TournamentReadiness, type TournamentSession, type YouTubeStream, duration, fileSize, request, savedLabels, savedMicrophones } from "./dashboard-shared";
import { StressResourceSummary, SystemResourceMonitor, type SystemResourceSnapshot } from "./SystemResources";
import { CaptureSignalHealthPanel } from "./CaptureSignalHealth";
import { CaptureRecoveryPanel } from "./CaptureRecoveryDetails";
import { CaptureQualityPanel } from "./CaptureQualityPanel";
import { CameraAssetInventory, UsbBandwidthPlanner, UsbTopologyDiagnostics } from "./HardwareDiagnostics";
import { IncidentAnalytics, IncidentHeatmap, IncidentLog, IncidentTimeline, IncidentTrends } from "./IncidentPanels";
import { CameraConfigurationReliabilityPanel, CameraDisconnectionAnalysis, CameraHealthHistoryPanel, CameraHealthPanel, CameraReliabilityDashboard, CameraTroubleshootingPanel, FailureInvestigationPanel, RecordingConfigurationReliabilityPanel, ReliabilityWarningsPanel, UsbRecordingCorrelationPanel, UsbReliabilityWarningsPanel } from "./CameraReliabilityPanels";
import { GuidedTroubleshootingTests } from "./GuidedTroubleshooting";
import { TournamentHardwareReport, TournamentLaunchShutdownGuide, TournamentReadinessOverview } from "./TournamentReadinessPanels";
import { PostTournamentTechnicalReport, TournamentReliabilityTrends, TournamentToTournamentComparison } from "./PostTournamentReports";
import { TournamentReportArchive, TournamentTechnicalSummary } from "./TournamentReports";

function NodeDashboard({ node }: { node: NodeInfo }) {
  const [operatorView, setOperatorView] = useState<OperatorView>("live");
  const [settingsView, setSettingsView] = useState<"devices"|"hardware"|"access">("devices");
  const [toolPanels, setToolPanels] = useState<Record<string, boolean>>({});
  const toggleTool = (id:string, open:boolean) => setToolPanels(previous=>previous[id]===open?previous:{...previous,[id]:open});
  const base = node.local ? "" : `/api/nodes/${encodeURIComponent(node.id)}`;
  // Remote capture commands are explicitly enabled per dashboard session, never saved.
  const [remoteCaptureControlsEnabled, setRemoteCaptureControlsEnabled] = useState(false);
  const remoteCaptureAllowed = node.local || remoteCaptureControlsEnabled;
  const requestNode = useCallback((url: string, options?: RequestInit) => {
    const method = (options?.method ?? "GET").toUpperCase();
    if (!node.local && method !== "GET") {
      if (!remoteCaptureControlsEnabled) return Promise.reject(new Error("Enable remote capture controls for this node first."));
      // The server also enforces operator authentication and a strict route allowlist.
      const allowed = method === "POST" && (/^\/api\/captures\/start$/.test(url) ||
        /^\/api\/captures\/stop-all$/.test(url) || /^\/api\/captures\/[^/?]+\/stop$/.test(url) ||
        /^\/api\/youtube\/[^/?]+\/(start|stop)$/.test(url) ||
        /^\/api\/session\/(start-all|stop-all)$/.test(url) ||
        /^\/api\/(captures|youtube)\/distributed-(start-all|stop-all)$/.test(url) ||
        /^\/api\/captures\/[^/?]+\/(?:recover|recording)$/.test(url) ||
        /^\/api\/youtube\/[^/?]+\/distributed-restart$/.test(url));
      if (!allowed) return Promise.reject(new Error("This remote setting is not enabled. Use the capture node locally."));
    }
    return request(`${base}${url}`, options);
  }, [base, node.local, remoteCaptureControlsEnabled]);
  const [connected, setConnected] = useState(false);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [alertSessionReady, setAlertSessionReady] = useState(false);
  const [devices, setDevices] = useState<DeviceList>({ cameras: [], microphones: [] });
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesReady, setDevicesReady] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [microphones, setMicrophones] = useState<Record<string, string>>(() => savedMicrophones(node.id));
  /** Prefer persisted pairings. Match a built-in webcam microphone only when names uniquely correspond. */
  function microphoneForCamera(camera: MediaDevice): { id: string; name: string } | null {
    const assignment = session.assignments.find(item=>item.cameraId===camera.id);
    const storedId = assignment?.microphoneId || settings?.devices[camera.id]?.pairedMicrophoneId;
    return chooseMicrophone(camera, devices.microphones, storedId, microphones[camera.id], assignment?.microphoneName);
  }

  const [labels, setLabels] = useState<Record<string, string>>(() => savedLabels(node.id));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const busyIdsRef = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [captureStartModes, setCaptureStartModes] = useState<Record<string, "production" | "diagnostic">>({});
  const [diagnosticReadiness, setDiagnosticReadiness] = useState<{localDiagnosticCaptureEnabled?: boolean; diagnosticCaptureAllowed?: boolean} | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SizeHistory>({});
  const [now, setNow] = useState(Date.now());
  const [session, setSession] = useState<TournamentSession>({ eventName: "", assignments: [] });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<Array<{ eventId: string; eventName: string; assignmentCount: number }>>([]);
  const [eventToSelect, setEventToSelect] = useState("");
  const [templates, setTemplates] = useState<Array<{ templateId: string; name: string; eventName: string; assignmentCount: number }>>([]);
  const [templateToLoad, setTemplateToLoad] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  async function refreshTemplates() {
    const result = await requestNode("/api/session/templates");
    setTemplates(result.templates);
  }
  async function saveTemplate() {
    const name = window.prompt("Name this reusable tournament setup template:", session.eventName);
    if (!name?.trim()) return;
    setTemplateBusy(true); setError(null);
    try {
      await requestNode("/api/session/templates", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      await refreshTemplates();
      setBulkResults(["Tournament template saved."]);
    } catch (cause) { setError(String(cause)); }
    finally { setTemplateBusy(false); }
  }
  async function loadTemplate() {
    if (!templateToLoad || !window.confirm("Apply template to the form? This will not change the saved tournament until you save it or create a new tournament ID.")) return;
    setTemplateBusy(true); setError(null);
    try {
      const result = await requestNode(`/api/session/templates/${encodeURIComponent(templateToLoad)}`);
      const template = result.template;
      setSession(old => ({ ...old, eventName: template.eventName,
        assignments: template.assignments.map((a: SessionAssignment) => ({ ...a })) }));
      setPreflight(null);
      setBulkResults(["Template applied to the form. Choose Create New Tournament ID to keep historical events separate."]);
    } catch (cause) { setError(String(cause)); }
    finally { setTemplateBusy(false); }
  }

  // Keep unavailable template devices visible until explicitly reassigned.
  function replaceAssignmentCamera(oldId: string, newId: string) {
    const camera = devices.cameras.find(device => device.id === newId);
    if (!camera || session.assignments.some(a => a.cameraId === newId && a.cameraId !== oldId)) {
      setError("Select an unassigned connected camera."); return;
    }
    const mic=chooseMicrophone(camera,devices.microphones,settings?.devices[camera.id]?.pairedMicrophoneId,microphones[camera.id]);
    setSession(old => ({ ...old, assignments: old.assignments.map(a => a.cameraId === oldId
      ? { ...a, cameraId: camera.id, cameraName: camera.name, microphoneName: mic?.name || "", microphoneId:mic?.id } : a) }));
    setPreflight(null); setError(null);
  }
  function replaceAssignmentMicrophone(cameraId: string, microphoneId: string) {
    const mic=devices.microphones.find(m=>m.id===microphoneId);
    if (!mic || session.assignments.some(a=>a.cameraId!==cameraId && (a.microphoneId ? a.microphoneId===microphoneId : a.microphoneName===mic.name))) {
      setError("Select an unassigned connected microphone."); return;
    }
    editDevice(cameraId,{pairedMicrophoneId:mic.id});
    setMicrophones(old=>({...old,[cameraId]:mic.id}));
    setSession(old=>({...old,assignments:old.assignments.map(a=>a.cameraId===cameraId?{...a,microphoneName:mic.name,microphoneId:mic.id}:a)}));
    setPreflight(null);setError(null);
  }

  async function refreshEvents() {
    const result = await requestNode("/api/session/events");
    setAvailableEvents(result.events);
    setEventToSelect((previous) => previous || result.selectedEventId || "");
  }
  async function selectSavedTournament() {
    if (!eventToSelect || eventToSelect === session.eventId) return;
    if (!window.confirm("Load this tournament's saved name and ring assignments? Unsaved changes to the current form will be lost.")) return;
    setSessionBusy(true); setError(null);
    try {
      const result = await requestNode("/api/session/select-event", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: eventToSelect })
      });
      setSession(result.session);
      setPreflight(null);
      setBulkResults([`Loaded tournament: ${result.session.eventName}`]);
      await refreshEvents();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  const [bulkResults, setBulkResults] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [readiness, setReadiness] = useState<TournamentReadiness | null>(null);
  const [equipmentTests, setEquipmentTests] = useState<Record<string, EquipmentTestResult>>({});
  const [encoderStats, setEncoderStats] = useState<EncoderStatsSnapshot | null>(null);
  const [encoderStatsError, setEncoderStatsError] = useState<string | null>(null);
  const [encoderStatsBusy, setEncoderStatsBusy] = useState(false);
  async function refreshEncoderStats() {
    setEncoderStatsBusy(true);
    try {
      const result = await requestNode("/api/captures/encoder-stats") as EncoderStatsSnapshot;
      setEncoderStats(result); setEncoderStatsError(null);
    } catch (error) { setEncoderStatsError(String(error)); }
    finally { setEncoderStatsBusy(false); }
  }
  const [stressBusy, setStressBusy] = useState(false);
  const [stressProgress, setStressProgress] = useState(0);
  const [stressResults, setStressResults] = useState<StressResult[] | null>(null);
  const [stressError, setStressError] = useState<string | null>(null);
  const [stressResources, setStressResources] = useState<StressResourceReport | null>(null);
  function exportStressReport(format: "json" | "csv") {
    if (!stressResults || !stressResources || stressBusy) return;
    const report = {
      schemaVersion: 1,
      test: "30-second multi-camera recording pipeline stress test",
      exportedAt: new Date().toISOString(),
      startedAt: stressResources.startedAt,
      endedAt: stressResources.endedAt,
      resourceSampleFailures: stressResources.failures,
      cameraResults: stressResults,
      resourceReadings: stressResources.readings,
      limitations: [
        "Observed FPS is preview sampling rate, not encoded recording FPS.",
        "GPU utilization is device-wide, not NVENC-specific.",
        "Disk counters are system-wide; readings are approximate.",
        "The test does not directly measure USB bandwidth or establish root cause."
      ]
    };
    const csvEscape = (value: unknown): string => {
      const string = value === null || value === undefined ? "" : String(value);
      return `"${string.replace(/"/g, '""')}"`;
    };
    let contents: string;
    let mime: string;
    if (format === "json") {
      contents = JSON.stringify(report, null, 2) + "\n";
      mime = "application/json";
    } else {
      const headers = ["recordType", "timestamp", "cameraId", "cameraName", "status",
        "observedPreviewFps", "growthBytes", "staleSamples", "missingSamples", "restarted",
        "cpuPercent", "ramUsedBytes", "gpuPercent", "gpuMemoryUsedMiB", "diskWriteBytesPerSec",
        "diskBusyPercent", "resourceSampleFailures"];
      const rows: unknown[][] = [headers];
      for (const result of stressResults) rows.push([
        "camera", stressResources.endedAt, result.cameraId, result.cameraName, result.status,
        result.observedFps, result.growthBytes, result.staleSamples, result.missingSamples,
        result.restarted, "", "", "", "", "", "", stressResources.failures
      ]);
      for (const reading of stressResources.readings) rows.push([
        "resource", reading.checkedAt, "", "", "", "", "", "", "", "",
        reading.cpu.utilizationPercent, reading.memory.usedBytes,
        reading.gpu?.utilizationPercent, reading.gpu?.memoryUsedMiB,
        reading.disk.writeBytesPerSec, reading.disk.busyPercent, stressResources.failures
      ]);
      contents = "\uFEFF" + rows.map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
      mime = "text/csv;charset=utf-8";
    }
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tournament-stress-${stressResources.startedAt.replace(/[:.]/g, "-")}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  type ImportedStressReport = {
    schemaVersion: number; startedAt: string; endedAt: string;
    cameraResults: StressResult[];
    resourceReadings: SystemResourceSnapshot[];
  };
  type SavedStressReport = { id: string; label: string; filename: string; report: ImportedStressReport };
  const historyKey = "tournament-stress-history-v1";
  const [savedStressReports, setSavedStressReports] = useState<SavedStressReport[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter((entry): entry is SavedStressReport =>
        !!entry && typeof entry.id === "string" && typeof entry.label === "string" &&
        typeof entry.filename === "string" && !!entry.report &&
        entry.report.schemaVersion === 1 && Array.isArray(entry.report.cameraResults) &&
        Array.isArray(entry.report.resourceReadings)).slice(-30);
    } catch { return []; }
  });
  const [historyLabel, setHistoryLabel] = useState("");
  const [historyError, setHistoryError] = useState("");
  function updateStressHistory(change: (previous: SavedStressReport[]) => SavedStressReport[]) {
    setSavedStressReports(previous => {
      const next = change(previous).slice(-30);
      try { localStorage.setItem(historyKey, JSON.stringify(next)); setHistoryError(""); }
      catch { setHistoryError("Browser storage is full or unavailable. Export JSON to keep a permanent copy."); }
      return next;
    });
  }
  function saveStressHistory(report: ImportedStressReport, label: string, filename: string) {
    const entry: SavedStressReport = {
      id: `${report.startedAt}-${Math.random().toString(36).slice(2, 10)}`,
      label: label.trim().slice(0, 100) || `Stress test ${new Date(report.startedAt).toLocaleString()}`,
      filename, report
    };
    updateStressHistory(previous => [...previous, entry]);
  }
  const [comparisonReports, setComparisonReports] = useState<Array<{ filename: string; report: ImportedStressReport }>>([]);
  const [comparisonError, setComparisonError] = useState("");
  async function importStressReports(files: FileList | null) {
    if (!files?.length) return;
    setComparisonError("");
    const imported: Array<{ filename: string; report: ImportedStressReport }> = [];
    for (const file of Array.from(files).slice(0, 12)) {
      try {
        if (file.size > 5_000_000) throw new Error("file exceeds 5 MB");
        const value: unknown = JSON.parse(await file.text());
        if (!value || typeof value !== "object") throw new Error("not a report object");
        const report = value as Partial<ImportedStressReport>;
        if (report.schemaVersion !== 1 || typeof report.startedAt !== "string" ||
            typeof report.endedAt !== "string" || !Array.isArray(report.cameraResults) ||
            !Array.isArray(report.resourceReadings) ||
            report.cameraResults.length > 100 || report.resourceReadings.length > 500 ||
            !report.cameraResults.every(camera => camera && typeof camera.cameraId === "string" &&
              typeof camera.cameraName === "string" && ["pass", "warning", "failed"].includes(camera.status) &&
              typeof camera.observedFps === "number" && Number.isFinite(camera.observedFps))) {
          throw new Error("invalid or unsupported milestone 43 JSON report");
        }
        imported.push({ filename: file.name, report: report as ImportedStressReport });
      } catch (error) { setComparisonError(previous => previous + `${file.name}: ${String(error)}\n`); }
    }
    setComparisonReports(previous => [...previous, ...imported].slice(-12));
    if (imported.length) updateStressHistory(previous => [...previous, ...imported.map(({ filename, report }) => ({
      id: `${report.startedAt}-${Math.random().toString(36).slice(2, 10)}`,
      label: filename.replace(/\.json$/i, "").slice(0, 100), filename, report
    }))]);
  }
  function summarizeComparison(report: ImportedStressReport) {
    const count = report.cameraResults.length;
    const passes = report.cameraResults.filter(camera => camera.status === "pass").length;
    const warnings = report.cameraResults.filter(camera => camera.status === "warning").length;
    const failed = report.cameraResults.filter(camera => camera.status === "failed").length;
    const averagePreviewFps = count ? report.cameraResults.reduce((sum, camera) => sum + camera.observedFps, 0) / count : null;
    const cpu = report.resourceReadings.map(reading => reading.cpu?.utilizationPercent).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const gpu = report.resourceReadings.map(reading => reading.gpu?.utilizationPercent).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const disk = report.resourceReadings.map(reading => reading.disk?.writeBytesPerSec).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return { count, passes, warnings, failed, averagePreviewFps, cpu: average(cpu), gpu: average(gpu), disk: average(disk) };
  }
  const [equipmentTesting, setEquipmentTesting] = useState<string | null>(null);
  const [equipmentTestError, setEquipmentTestError] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessDraft, setReadinessDraft] = useState<string | null>(null);
  const [preflightDraft, setPreflightDraft] = useState<string | null>(null);
  const [youtubeStreams, setYoutubeStreams] = useState<YouTubeStream[]>([]);
  const [recordingEvents, setRecordingEvents] = useState<RecordingEvent[]>([]);
  const [pastSessions, setPastSessions] = useState<Array<{
    cameraId: string; cameraName: string; recordingPath: string; startedAt: string; endedAt?: string;
    eventId?: string; eventName?: string; ring?: string;
    outcome: string; integrity: { status: string; issues: string[]; segments: Array<{name: string; bytes: number}>; totalBytes?: number };
  }>>([]);
  const [validationResults, setValidationResults] = useState<Record<string, {status: string; issues: string[]; checked: number; total: number}>>({});
  const [validationBusy, setValidationBusy] = useState(false);
  async function validateSession(recordingPath: string) {
    setValidationBusy(true);
    try {
      const result = await requestNode("/api/recording-history/validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingPath })
      });
      setValidationResults(previous => ({ ...previous, [recordingPath]: result }));
    } catch (error) { setPastSessionsError(String(error)); }
    finally { setValidationBusy(false); }
  }
  const [pastSessionsError, setPastSessionsError] = useState("");
  const [pastSessionsLoading, setPastSessionsLoading] = useState(false);
  const [recordingSummary, setRecordingSummary] = useState<RecordingSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  async function runCameraStressTest() {
    setStressBusy(true); setStressProgress(0); setStressResults(null); setStressError(null); setStressResources(null);
    try {
      const samples: StressSnapshot[] = [];
      const readings: SystemResourceSnapshot[] = [];
      let resourceFailures = 0;
      const sampleResources = async () => {
        try { readings.push(await requestNode("/api/system/resources") as SystemResourceSnapshot); }
        catch { resourceFailures++; }
      };
      // 30 seconds of actual simultaneous recording, without touching stream state.
      const first = await requestNode("/api/captures/stress-snapshot") as StressSnapshot;
      if (first.captures.length < 2) throw new Error("Start recordings on at least two cameras before running the stress test.");
      samples.push(first);
      const resourceStart = new Date().toISOString();
      await sampleResources();
      const started = Date.now();
      for (let second = 1; second <= 30; second++) {
        const wait = Math.max(0, started + second * 1000 - Date.now());
        await new Promise<void>(resolve => window.setTimeout(resolve, wait));
        // Collect OS metrics every 5 seconds. Failure never aborts the camera test.
        const [capture] = await Promise.all([
          requestNode("/api/captures/stress-snapshot") as Promise<StressSnapshot>,
          second % 5 === 0 ? sampleResources() : Promise.resolve()
        ]);
        samples.push(capture);
        setStressProgress(second);
      }
      const last = samples[samples.length - 1];
      const elapsed = Math.max(1, (last.checkedAt - first.checkedAt) / 1000);
      const results: StressResult[] = first.captures.map(initial => {
        const seen = samples.map(sample => sample.captures.find(item => item.cameraId === initial.cameraId));
        const ending = seen[seen.length - 1];
        const missingSamples = seen.filter(item => !item || !item.running).length;
        const restarted = seen.some(item => item && item.startedAt !== initial.startedAt);
        const staleSamples = seen.filter(item => item && (item.frameAgeMs === null || item.frameAgeMs > 3000)).length;
        const observedFps = ending && !restarted && ending.frameCount >= initial.frameCount
          ? (ending.frameCount - initial.frameCount) / elapsed : 0;
        const growthBytes = ending && ending.recordingBytes !== null && initial.recordingBytes !== null &&
          !restarted ? ending.recordingBytes - initial.recordingBytes : null;
        const status = missingSamples || restarted || !ending ? "failed" :
          staleSamples > 2 || observedFps < 3 || growthBytes === null || growthBytes <= 0 ? "warning" : "pass";
        return { cameraId: initial.cameraId, cameraName: initial.cameraName,
          sampleCount: seen.length, observedFps, growthBytes, staleSamples, missingSamples,
          restarted, status };
      });
      const extra = last.captures.filter(item => !first.captures.some(old => old.cameraId === item.cameraId));
      if (extra.length) setStressError(`Additional recordings started during the test: ${extra.map(item => item.cameraName).join(", ")}. Rerun for a consistent baseline.`);
      setStressResults(results);
      const resourceEnd = new Date().toISOString();
      setStressResources({ readings, failures: resourceFailures,
        startedAt: resourceStart, endedAt: resourceEnd });
      saveStressHistory({ schemaVersion: 1, startedAt: resourceStart, endedAt: resourceEnd,
        cameraResults: results, resourceReadings: readings },
        historyLabel || `Automatic test ${new Date(resourceStart).toLocaleString()}`,
        `tournament-stress-${resourceStart.replace(/[:.]/g, "-")}.json`);
    } catch (cause) { setStressError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStressBusy(false); }
  }

  async function testRingEquipment(assignment: SessionAssignment) {
    setEquipmentTesting(assignment.cameraId);
    setEquipmentTestError(null);
    try {
      const result: EquipmentTestResult = await requestNode("/api/device-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId: assignment.cameraId, microphoneName: assignment.microphoneName, microphoneId: assignment.microphoneId })
      });
      setEquipmentTests(previous => ({ ...previous, [assignment.cameraId]: result }));
    } catch (error) { setEquipmentTestError(String(error)); }
    finally { setEquipmentTesting(null); }
  }

  async function checkTournamentReadiness() {
    setReadinessBusy(true);
    setReadinessError(null);
    const draft = JSON.stringify(session);
    try {
      const [preflightResult, cameraData, captureData, captureHealthData, streamData, diskResult] = await Promise.all([
        requestNode("/api/session/preflight", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: draft
        }) as Promise<PreflightResult>,
        requestNode("/api/devices") as Promise<DeviceList>,
        requestNode("/api/captures") as Promise<{ captures: Capture[] }>,
        requestNode("/api/captures/health") as Promise<{ captures: CaptureHealth[] }>,
        requestNode("/api/youtube/streams") as Promise<{ streams: YouTubeStream[] }>,
        requestNode("/api/storage/health").then((storage: StorageHealth) =>
          ({ storage, error: null as string | null }),
          (error: unknown) => ({ storage: null as StorageHealth | null, error: String(error) }))
      ]);
      const blockers = preflightResult.checks.filter((item: PreflightResult["checks"][number]) => item.level === "error").map((item: PreflightResult["checks"][number]) => item.message);
      const warnings = preflightResult.checks.filter((item: PreflightResult["checks"][number]) => item.level === "warning").map((item: PreflightResult["checks"][number]) => item.message);
      if (diskResult.error) blockers.push(`Storage check unavailable: ${diskResult.error}`);
      if (diskResult.storage?.status === "critical") blockers.push("Recording disk below critical threshold.");
      const rings = session.assignments.map(assignment => {
        const capture = captureData.captures.find((item: Capture) => item.cameraId === assignment.cameraId);
        const health = captureHealthData.captures.find((item: CaptureHealth) => item.cameraId === assignment.cameraId);
        const stream = streamData.streams.find((item: YouTubeStream) => item.cameraId === assignment.cameraId);
        const cameraConnected = cameraData.cameras.some((item: MediaDevice) => item.id === assignment.cameraId);
        const microphoneConnected = cameraData.microphones.some((item: MediaDevice) => item.name === assignment.microphoneName);
        const issues = [
          ...(!cameraConnected ? ["Camera disconnected"] : []),
          ...(!microphoneConnected ? ["Microphone disconnected"] : []),
          ...(health?.status === "warning" ? health.warnings : []),
          ...(stream?.status === "error" ? ["YouTube relay error"] : [])
        ];
        if (health?.status === "warning") warnings.push(`${assignment.ring}: recording health warning.`);
        if (stream?.status === "error") warnings.push(`${assignment.ring}: YouTube relay error.`);
        return { ring: assignment.ring, camera: assignment.cameraName, cameraConnected,
          microphoneConnected, recording: !!capture?.running,
          recordingHealthy: health ? health.status === "healthy" : null,
          youtubeLive: stream?.status === "live", issues };
      });
      setReadiness({ checkedAt: new Date().toISOString(), preflight: preflightResult,
        storage: diskResult.storage, storageError: diskResult.error, rings, blockers, warnings });
      setReadinessDraft(draft);
    } catch (cause) { setReadiness(null); setReadinessError(String(cause)); }
    finally { setReadinessBusy(false); }
  }

  async function refreshRecordingSummary() {
    setSummaryBusy(true);
    try {
      setRecordingSummary(await requestNode(`/api/recording-history/summary${selectedEventId ? `?eventId=${encodeURIComponent(selectedEventId)}` : ""}`));
      setSummaryError("");
    } catch (error) { setSummaryError(String(error)); }
    finally { setSummaryBusy(false); }
  }

  const [reportBusy, setReportBusy] = useState(false);
  async function downloadRecordingReport(format: "csv" | "json") {
    if (!node.local) { setPastSessionsError("Download reports from the capture node's local dashboard."); return; }
    setReportBusy(true);
    try {
      const headers = new Headers();
      if (operatorApi.getToken()) headers.set("Authorization", `Bearer ${operatorApi.getToken()}`);
      const response = await fetch(`/api/recording-history/report?format=${format}`, { headers });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Report download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.href = url;
      link.download = `tournament-recording-report-${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setPastSessionsError("");
    } catch (cause) { setPastSessionsError(String(cause)); }
    finally { setReportBusy(false); }
  }

  async function refreshPastSessions() {
    setPastSessionsLoading(true);
    try {
      const data = await requestNode("/api/recording-history?limit=50");
      setPastSessions(data.sessions);
      setPastSessionsError("");
    } catch (cause) { setPastSessionsError(String(cause)); }
    finally { setPastSessionsLoading(false); }
  }

  const [captureHealth, setCaptureHealth] = useState<CaptureHealth[]>([]);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [streamKeys, setStreamKeys] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [keyImportFile, setKeyImportFile] = useState<File | null>(null);
  const [keyImportBusy, setKeyImportBusy] = useState(false);
  const [keyImportMessage, setKeyImportMessage] = useState("");

  useEffect(() => { localStorage.setItem(`tournament-camera-labels-${node.id}`, JSON.stringify(labels)); }, [labels]);
  useEffect(() => { localStorage.setItem(`tournament-camera-microphones-${node.id}`, JSON.stringify(microphones)); }, [microphones]);

  async function refreshDevices() {
    setDevicesLoading(true);
    try {
      const result: DeviceList = await requestNode("/api/devices");
      setDevices(result);
      setDevicesReady(true);
      setMicrophones((previous) => {
        const updated: Record<string, string> = {...previous};
        // Never guess pairings from enumeration order: identical USB cameras can reorder.
        for (const camera of result.cameras) {
          const previousMic = previous[camera.id];
          updated[camera.id] = previousMic || "";
        }
        return updated;
      });
    } catch (cause) { setError(String(cause)); }
    finally { setDevicesLoading(false); }
  }

  useEffect(() => {
    void refreshDevices();
    void requestNode("/api/recording-events").then((data: { events: RecordingEvent[] }) => setRecordingEvents(data.events)).catch(() => {});
    void requestNode("/api/output-mode/readiness")
      .then((data: { diagnosticWatermarkReady?: boolean }) =>
        setDiagnosticReadiness({ localDiagnosticCaptureEnabled: data.diagnosticWatermarkReady === true }))
      .catch(() => setDiagnosticReadiness(null));
    void refreshYouTubeProfiles();
    if (node.local) void requestNode("/api/settings")
      .then((data: {settings: AppSettings}) => setSettings(data.settings))
      .catch((cause: unknown) => setError(String(cause)));
    if (node.local) void requestNode("/api/network/status")
      .then((data: NetworkStatus) => setNetworkStatus(data))
      .catch(() => setNetworkStatus(null));
    void refreshEvents().catch(() => {});
    void requestNode("/api/session").then((data: { session: TournamentSession | null }) => {
      if (data.session) setSession(data.session);
      setAlertSessionReady(true);
    }).catch((cause: unknown) => setError(String(cause)));
  }, []);
  useEffect(() => {
    let active = true;
    let polling = false;
    let lastAuxPoll = 0;
    let auxiliaryPending = false;
    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const [captureData, previewData, youtubeData, healthData] = await Promise.all([
          requestNode("/api/captures"), requestNode("/api/previews"), requestNode("/api/youtube/streams"), requestNode("/api/captures/health")
        ]);
        if (!active) return;
        const nextCaptures = captureData.captures as Capture[];
        setCaptures(nextCaptures);
        setPreviews(previewData.previews as Preview[]);
        setYoutubeStreams(youtubeData.streams as YouTubeStream[]);
        setCaptureHealth(healthData.captures as CaptureHealth[]);
        if (!auxiliaryPending && Date.now()-lastAuxPoll>=10000) {
        lastAuxPoll=Date.now();
        auxiliaryPending=true;
        const storageRequest = requestNode("/api/storage/health")
          .then((data: StorageHealth) => { if (active) { setStorageHealth(data); setStorageError(null); } })
          .catch((cause: unknown) => { if (active) { setStorageHealth(null); setStorageError(String(cause)); } });
        const eventsRequest = requestNode("/api/recording-events").then((data: { events: RecordingEvent[] }) => {
          if (active) setRecordingEvents(data.events);
        }).catch(() => {});
        void Promise.allSettled([storageRequest, eventsRequest]).then(()=>{auxiliaryPending=false;});
        }
        setConnected(true);
        setConnectionChecked(true);
        const timestamp = Date.now();
        setHistory((previous) => {
          const next: SizeHistory = {};
          for (const capture of nextCaptures) {
            if (capture.recordingFileSize === null) continue;
            const old = previous[capture.cameraId];
            next[capture.cameraId] = !old || old.startedAt !== capture.startedAt ||
              capture.recordingFileSize > old.size
              ? { size: capture.recordingFileSize, lastGrowthAt: timestamp, startedAt: capture.startedAt }
              : { ...old, size: capture.recordingFileSize };
          }
          return next;
        });
      } catch {
        if (active) { setConnected(false); setConnectionChecked(true); }
      } finally { polling = false; }
    };
    const interval = startPolling(poll, 2000);
    return () => { active = false; interval(); };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function perform(cameraId: string, action: () => Promise<void>) {
    if (!remoteCaptureAllowed) { setError("Enable remote capture controls for this node first."); return; }
    if (!node.local && !window.confirm(`Perform this camera operation on ${node.name}?`)) return;
    if (busyIdsRef.current.has(cameraId)) return;
    busyIdsRef.current.add(cameraId);
    setBusyIds((old) => [...old, cameraId]);
    setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyIdsRef.current.delete(cameraId); setBusyIds((old) => old.filter((id) => id !== cameraId)); }
  }
  async function togglePreview(camera: MediaDevice, active: boolean) {
    await perform(camera.id, async () => {
      if (active) {
        await requestNode(`/api/previews/${encodeURIComponent(camera.id)}/stop`, { method: "POST" });
        setPreviews((old) => old.filter((preview) => preview.cameraId !== camera.id));
      } else {
        await requestNode("/api/previews/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraId: camera.id, cameraName: camera.name })
        });
        const data = await requestNode("/api/previews");
        setPreviews(data.previews);
      }
    });
  }
  async function recoverRecording(camera: MediaDevice) {
    if (!window.confirm(`Restart recording for ${labelFor(camera.id, camera.name)}? This finalizes the current file and stops YouTube streaming until manually restarted. Recovery is limited to twice per hour per camera, with a 5-minute cooldown.`)) return;
    await perform(camera.id, async () => {
      const result = await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/recover`, { method: "POST" });
      setBulkResults([`${labelFor(camera.id, camera.name)}: ${result.message}`]);
      const [captureData, streamData] = await Promise.all([
        requestNode("/api/captures"), requestNode("/api/youtube/streams")
      ]);
      setCaptures(captureData.captures);
      setYoutubeStreams(streamData.streams);
    });
  }

  async function toggleRecording(camera: MediaDevice, capture?: Capture) {
    await perform(camera.id, async () => {
      if (capture?.recordingSwitchSupported && remoteCaptureAllowed) {
        await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/recording`, {
          method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!capture.recordingEnabled})
        });
        if (capture.recordingEnabled && !youtubeStreams.some(stream=>stream.cameraId===camera.id)) {
          await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/stop`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({onlyIfIdle:true})});
        }
        const data=await requestNode("/api/captures");setCaptures(data.captures);return;
      }
      if (capture?.recordingEnabled === false) {
        // FFmpeg has a fixed output graph. Never restart an active live relay silently.
        if (youtubeStreams.some(stream => stream.cameraId === camera.id)) {
          throw new Error("Stop the live stream before switching to recording. Recording and streaming can be started independently.");
        }
        await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/stop`, { method: "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({recordingsOnly:true}) });
      } else if (capture) {
        if (youtubeStreams.some(stream => stream.cameraId === camera.id)) {
          throw new Error("Stop the live stream before stopping recording, because the current capture supplies both outputs.");
        }
        await requestNode(`/api/captures/${encodeURIComponent(camera.id)}/stop`, { method: "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({recordingsOnly:true}) });
        const data = await requestNode("/api/captures");
        setCaptures(data.captures);
        return;
      }
      const selectedMicrophone = microphoneForCamera(camera);
      const microphoneId = selectedMicrophone?.id;
      const microphoneName = selectedMicrophone?.name;
      if (!microphoneName) throw new Error(`Assign a microphone to ${camera.name} first.`);
      await requestNode("/api/captures/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId: camera.id, cameraName: camera.name,
          cameraDeviceId: camera.id, microphoneName, microphoneId,
          recordingEnabled: true, mode: "production" })
      });
      const data = await requestNode("/api/captures");
      setCaptures(data.captures);
    });
  }

  async function refreshYouTubeProfiles() {
    try {
      const result = await requestNode("/api/youtube/profiles");
      setSavedProfiles(Object.fromEntries((result.profiles as { cameraId: string; label: string }[]).map(p => [p.cameraId, p.label])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function saveYouTubeKey(camera: MediaDevice) {
    const streamKey = streamKeys[camera.id]?.trim();
    if (!streamKey) { setError("Enter a stream key before saving."); return; }
    try {
      await requestNode(`/api/youtube/profiles/${encodeURIComponent(camera.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelFor(camera.id, camera.name), streamKey })
      });
      setStreamKeys(old => ({ ...old, [camera.id]: "" }));
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function downloadYouTubeTemplate() {
    const payload = { format: "tournament-youtube-keys-v1", profiles: devices.cameras.map(camera => ({
      cameraId: camera.id, label: labelFor(camera.id, camera.name), streamKey: ""
    })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "youtube-keys-template.json";
    anchor.click(); URL.revokeObjectURL(url);
  }

  async function importYouTubeKeys() {
    if (!node.local || !keyImportFile) return;
    if (!window.confirm("Import stream keys from this file? Matching saved keys will be replaced. Treat the source file as sensitive and delete it securely when finished.")) return;
    setKeyImportBusy(true); setKeyImportMessage(""); setError(null);
    try {
      if (keyImportFile.size > 128 * 1024) throw new Error("Import file is too large (128 KiB maximum).");
      const payload = JSON.parse(await keyImportFile.text());
      const result = await requestNode("/api/youtube/profiles/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      setKeyImportMessage(`Imported ${result.imported} stream profiles. ${result.total} saved on this computer.`);
      setKeyImportFile(null);
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setKeyImportBusy(false); }
  }

  async function deleteYouTubeKey(cameraId: string) {
    if (!window.confirm("Remove the saved YouTube stream key for this camera?")) return;
    try {
      await requestNode(`/api/youtube/profiles/${encodeURIComponent(cameraId)}`, { method: "DELETE" });
      await refreshYouTubeProfiles();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function toggleYouTube(cameraId: string, active: boolean) {
    await perform(cameraId, async () => {
      if (active) {
        await requestNode(`/api/youtube/${encodeURIComponent(cameraId)}/stop`, { method: "POST" });
        // Shut down only the temporary stream-only capture, never an operator recording.
        const capture = captures.find(item => item.cameraId === cameraId);
        if (capture?.recordingEnabled === false) {
          await requestNode(`/api/captures/${encodeURIComponent(cameraId)}/stop`, { method: "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({onlyIfIdle:true}) });
        }
      } else {
        const streamKey = streamKeys[cameraId]?.trim();
        if (!streamKey && !savedProfiles[cameraId]) throw new Error("Enter a YouTube key or save one first.");
        let startedStreamOnly = false;
        const camera = devices.cameras.find(item => item.id === cameraId);
        if (!captures.some(item => item.cameraId === cameraId && item.running)) {
          if (!camera) throw new Error("Camera not connected.");
          const selectedMicrophone = microphoneForCamera(camera);
          const microphoneId = selectedMicrophone?.id;
          const microphoneName = selectedMicrophone?.name;
          if (!microphoneName) throw new Error("Select a microphone before streaming.");
          await requestNode("/api/captures/start", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({cameraId, cameraName: camera.name, cameraDeviceId: camera.id,
              microphoneId, microphoneName, mode: "production", recordingEnabled: false}) });
          startedStreamOnly = true;
        }
        try {
          await requestNode(`/api/youtube/${encodeURIComponent(cameraId)}/start`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(streamKey ? { streamKey } : {})
          });
        } catch (error) {
          if (startedStreamOnly) {
            try { await requestNode(`/api/captures/${encodeURIComponent(cameraId)}/stop`, { method: "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({onlyIfIdle:true}) }); }
            catch { /* Keep the original relay error and surface any surviving capture in refresh. */ }
          }
          throw error;
        }
        setStreamKeys(old => ({ ...old, [cameraId]: "" }));
      }
      const [streamData, captureData] = await Promise.all([requestNode("/api/youtube/streams"), requestNode("/api/captures")]);
      setYoutubeStreams(streamData.streams);
      setCaptures(captureData.captures);
    });
  }

  async function createNewTournament() {
    if (!window.confirm("Create a new tournament ID? Historical recordings will stay linked to the previous tournament, even if you reuse its name.")) return;
    setSessionBusy(true); setError(null);
    try {
      const result = await requestNode("/api/session/new-event", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(session)
      });
      setSession(result.session);
      setEventToSelect(result.session.eventId || "");
      await refreshEvents();
      setBulkResults(["New tournament created. Permanent ID: " + result.session.eventId]);
    } catch (cause) { setError(String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function saveSession() {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    setSessionBusy(true); setError(null);
    try {
      const result: { session: TournamentSession } = await requestNode("/api/session", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session)
      });
      setSession(result.session);
      setEventToSelect(result.session.eventId || "");
      await refreshEvents();
      setBulkResults(["Session saved."]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function runPreflight() {
    setPreflightBusy(true); setError(null);
    try {
      setPreflightDraft(JSON.stringify(session));
      setPreflight(await requestNode("/api/session/preflight", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session)
      }) as PreflightResult);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPreflightBusy(false); }
  }

  async function bulkAction(action: "start-all" | "stop-all") {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    if (action === "stop-all" && !window.confirm(`Stop all recordings on ${node.name}?`)) return;
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    setSessionBusy(true); setError(null);
    try {
      const result: { results: { cameraId: string; ok: boolean; error?: string }[] } =
        await requestNode(`/api/session/${action}`, { method: "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(action==="stop-all"?{recordingsOnly:true}:{}) });
      setBulkResults(result.results.map((item) => {
        const name = session.assignments.find((assignment) => assignment.cameraId === item.cameraId)?.ring ??
          item.cameraId;
        return `${name}: ${item.ok ? "OK" : item.error ?? "Failed"}`;
      }));
      const capturesData = await requestNode("/api/captures");
      setCaptures(capturesData.captures);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  async function bulkYouTube(action: "start-all" | "stop-all") {
    if (!node.local) { setError("Remote nodes are read-only."); return; }
    if (action === "start-all" && !window.confirm("Start assigned YouTube streams? Cameras without recordings will use stream-only capture.")) return;
    if (action === "stop-all" && !window.confirm("Stop YouTube streams on this node? Existing disk recordings will continue.")) return;
    setSessionBusy(true); setError(null);
    try {
      const first: {streams: YouTubeStream[]} = await requestNode("/api/youtube/streams");
      const initiallyActive = new Set(first.streams.map(stream => stream.cameraId));
      const cameraIds = action === "start-all"
        ? session.assignments.map(item => item.cameraId)
        : first.streams.map(item => item.cameraId);
      // One camera at a time: reuse the same capture reservation and failure cleanup as the per-camera control.
      for (const cameraId of new Set(cameraIds)) {
        if (action === "start-all" && initiallyActive.has(cameraId)) continue;
        await toggleYouTube(cameraId, action === "stop-all");
      }
      const latest: {streams: YouTubeStream[]} = await requestNode("/api/youtube/streams");
      const latestIds = new Set(latest.streams.map(stream => stream.cameraId));
      setBulkResults(cameraIds.map(cameraId => {
        const ring = session.assignments.find(item => item.cameraId === cameraId)?.ring ?? cameraId;
        const success = action === "start-all" ? latestIds.has(cameraId) : !latestIds.has(cameraId);
        return `${ring}: ${success ? (action === "start-all" ? "Streaming" : "Stopped") : "Needs attention"}`;
      }));
      setYoutubeStreams(latest.streams);
      const captureData = await requestNode("/api/captures");
      setCaptures(captureData.captures);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSessionBusy(false); }
  }

  const activeRecordings = captures.filter((capture) => capture.running && capture.recordingEnabled !== false);
  const unhealthy = activeRecordings.filter((capture) =>
    capture.previewFrozen || (history[capture.cameraId] &&
      now - history[capture.cameraId].lastGrowthAt > 10000));
  const healthy = activeRecordings.filter((capture) =>
    !capture.previewFrozen && history[capture.cameraId] &&
    now - history[capture.cameraId].lastGrowthAt <= 10000).length;
  const labelFor = (cameraId: string, name: string) =>
    session.assignments.find(item => item.cameraId === cameraId)?.ring?.trim() ||
    settings?.devices[cameraId]?.alias?.trim() || labels[cameraId]?.trim() ||
    devices.allDevices?.find((d) => d.id === cameraId)?.displayName || name;
  const visibleCameras = devices.cameras.filter((camera) => settings?.devices[camera.id]?.hidden !== true);
  const allDevices = devices.allDevices ?? [...devices.cameras, ...devices.microphones];
  const editDevice = (id: string, patch: DevicePreference) => setSettings((previous) => previous ? ({
    ...previous, devices: { ...previous.devices, [id]: { ...previous.devices[id], ...patch } }
  }) : previous);
  async function saveSettings() {
    if (!settings || !node.local) return;
    setSettingsBusy(true); setSettingsMessage("");
    try {
      const result: {settings: AppSettings; restartRequired: boolean} = await requestNode("/api/settings", {
        method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(settings)
      });
      setSettings(result.settings);
      setSettingsMessage("Settings saved. Restart the backend if you changed network mode or bind address.");
      await refreshDevices();
    } catch (cause) { setError(String(cause)); }
    finally { setSettingsBusy(false); }
  }
  async function downloadBackup() {
    try {
      const data = await requestNode("/api/config/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = "tournament-backup.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(String(cause)); }
  }
  async function restoreBackup() {
    if (!restoreFile || !window.confirm("Restore this configuration? Existing settings and session assignments will be replaced.")) return;
    setSettingsBusy(true);
    try {
      const backup = JSON.parse(await restoreFile.text());
      const result = await requestNode("/api/config/restore", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(backup) });
      setSettings(result.settings); setSession(result.session);
      setSettingsMessage("Backup restored. Restart the backend for network changes.");
      await refreshDevices();
    } catch (cause) { setError(String(cause)); }
    finally { setSettingsBusy(false); }
  }

  const [relayStaleSeconds, setRelayStaleSeconds] = useState<number>(() => {
    try { const value = Number(localStorage.getItem(`tournament-relay-stale-v1:${node.id}`));
      return [15, 30, 60, 120].includes(value) ? value : 30; } catch { return 30; }
  });
  useEffect(() => {
    try { localStorage.setItem(`tournament-relay-stale-v1:${node.id}`, String(relayStaleSeconds)); }
    catch { /* storage unavailable */ }
  }, [node.id, relayStaleSeconds]);
  // Poll the capture node's persisted USB connection history, rather than relying
  // on browser-local estimates. Fetch failure must not clear previously known alerts.
  const [usbConnectionWarnings, setUsbConnectionWarnings] = useState<Array<{
    cameraId: string; cameraName: string; severity: OperationsAlertSeverity;
    reasons: string[]; currentlyDisconnected: boolean;
  }>>([]);
  const [usbWarningsReady, setUsbWarningsReady] = useState(false);
  const [usbWarningsError, setUsbWarningsError] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result: { warnings: Array<{ cameraId: string; cameraName: string;
          severity: OperationsAlertSeverity; reasons: string[]; currentlyDisconnected: boolean }> } =
          await requestNode("/api/camera-health/usb-warnings");
        if (!mounted) return;
        setUsbConnectionWarnings(Array.isArray(result.warnings) ? result.warnings : []);
        setUsbWarningsReady(true);
        setUsbWarningsError("");
      } catch (cause) {
        if (mounted) setUsbWarningsError(String(cause));
      }
    };
    const timer = startPolling(refresh, 30_000);
    return () => { mounted = false; timer(); };
  }, [node.id]);
  const operationsAlerts: OperationsAlertInput[] = [];
  // Stable per-camera keys ensure existing acknowledgement, resolution, audible
  // alerts and automatic critical incident creation work without duplicate spam.
  for (const warning of usbConnectionWarnings) {
    if (!warning.cameraId || !Array.isArray(warning.reasons)) continue;
    operationsAlerts.push({
      key: `usb-reliability:${warning.cameraId}`,
      severity: warning.severity === "critical" ? "critical" : "warning",
      message: `${warning.cameraName || warning.cameraId}: USB connection reliability: ${warning.reasons.join("; ")}`
    });
  }
  if (connectionChecked && !connected) operationsAlerts.push({ key: "node-disconnected", severity: "critical", message: "Node API disconnected" });
  if (storageHealth?.status === "critical") operationsAlerts.push({ key: "storage-critical", severity: "critical",
    message: `Recording storage critical: ${fileSize(storageHealth.freeBytes)} remaining` });
  if (storageHealth?.status === "warning") operationsAlerts.push({ key: "storage-warning", severity: "warning",
    message: `Recording storage low: ${fileSize(storageHealth.freeBytes)} remaining` });
  if (storageError) operationsAlerts.push({ key: "storage-unavailable", severity: "warning", message: `Storage status unavailable: ${storageError}` });
  for (const assignment of session.assignments) {
    const id = assignment.cameraId;
    const ring = assignment.ring;
    const capture = captures.find(c => c.cameraId === id);
    const health = captureHealth.find(h => h.cameraId === id);
    const stream = youtubeStreams.find(y => y.cameraId === id);
    if (devicesReady && !devices.cameras.some(d => d.id === id)) operationsAlerts.push({ key: `camera-missing:${id}`, severity: "critical", message: `${ring}: camera not detected` });
    if (health?.status === "warning") operationsAlerts.push({ key: `recording-warning:${id}`, severity: "warning", message: `${ring}: ${health.warnings.join("; ") || "recording warning"}` });
    if (capture?.previewFrozen) operationsAlerts.push({ key: `preview-frozen:${id}`, severity: "warning", message: `${ring}: preview frozen` });
    if (stream?.status === "error") operationsAlerts.push({ key: `relay-error:${id}`, severity: "critical", message: `${ring}: ${stream.error || "YouTube relay error"}` });
    if (stream?.status === "live" && typeof stream.progressAgeMs === "number" &&
        stream.progressAgeMs > relayStaleSeconds * 1000)
      operationsAlerts.push({ key: `relay-stalled:${id}`, severity: "warning",
        message: `${ring}: YouTube relay progress stale (${Math.round(stream.progressAgeMs / 1000)}s)` });
  }


  // Publish the same actionable alerts already used by the node's operations history.
  // Serialize content to avoid emitting an update on unrelated dashboard renders.
  const alertSnapshotReady = connected && connectionChecked && alertSessionReady && devicesReady && usbWarningsReady && !usbWarningsError && Boolean(storageHealth) && !storageError;
  const globalAlertSignature = JSON.stringify(operationsAlerts);
  useEffect(() => {
    const alerts = JSON.parse(globalAlertSignature) as OperationsAlertInput[];
    window.dispatchEvent(new CustomEvent("tournament:operations-alerts", {
      detail: { nodeId: node.id, nodeName: node.name, online: connected, complete: alertSnapshotReady, alerts }
    }));
  }, [node.id, node.name, connected, alertSnapshotReady, globalAlertSignature]);

  return (
    <section className="node-panel" aria-label={`${node.name} cameras`}>
      <header className="dashboard-header">
        <div>
          <h2>{node.name}</h2>
          <p className="muted">{node.local ? "Primary PC" : "Remote PC"} · Camera monitoring and recording</p>
        </div>
        {node.local && <nav className="node-display-links" aria-label="Tournament displays">
          <a href="/presentation?mode=cameras" target="_blank" rel="noopener noreferrer">Camera Display</a>
          <a href="/presentation?mode=schedule" target="_blank" rel="noopener noreferrer">Billboard</a>
        </nav>}
        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="status-dot" /> {connected ? "Connected" : "Disconnected"}
        </div>
      </header>

      <OperatorNavigation view={operatorView} onChange={setOperatorView} nodeName={node.name} />
      {error && <OperatorErrorNotice message={error} onDismiss={()=>setError(null)} />}
      <section className="session-panel" hidden={operatorView!=="live" && operatorView!=="setup"}>
        <div className="section-heading"><h3>{operatorView==="setup"?"Tournament Setup":session.eventName || "No tournament configured"}</h3>
          <span className="muted">Saved locally.</span>
        </div>
        {operatorView==="live" && <div className="event-summary-row"><span>{session.assignments.length} assigned rings</span>
          <button type="button" onClick={()=>setOperatorView("setup")}>Edit tournament</button></div>}
        <div hidden={operatorView!=="setup"}>
        <div className="event-identity-row">
          <label className="field event-name-field">
            <span>Event name</span>
            <input value={session.eventName} placeholder="e.g. Fall Championship 2026"
              disabled={!node.local || sessionBusy || activeRecordings.length > 0}
              onChange={(event) => setSession((old) => ({ ...old, eventName: event.target.value }))} />
          </label>
          {session.eventId && <div className="event-id-field"><span>Permanent event ID</span><code title={session.eventId}>{session.eventId}</code></div>}
        </div>
        <div className="camera-actions">
          <label className="field"><span>Previously configured tournaments</span>
            <select value={eventToSelect} disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onChange={event => setEventToSelect(event.target.value)}>
              <option value="">Select a saved tournament</option>
              {availableEvents.map(item => <option key={item.eventId} value={item.eventId}>
                {item.eventName} ({item.assignmentCount} rings, {item.eventId.slice(0, 8)})
              </option>)}
            </select>
          </label>
          <button type="button" disabled={!node.local || sessionBusy || !eventToSelect || eventToSelect === session.eventId || activeRecordings.length > 0 || youtubeStreams.length > 0}
            onClick={() => void selectSavedTournament()}>Load Selected Tournament</button>
          <button type="button" disabled={!connected} onClick={() => void refreshEvents().catch(cause => setError(String(cause)))}>Refresh Tournament List</button>
          <div className="camera-actions">
            <select aria-label="Saved tournament template" value={templateToLoad}
              onChange={event => setTemplateToLoad(event.target.value)}>
              <option value="">Select setup template</option>
              {templates.map(item => <option key={item.templateId} value={item.templateId}>
                {item.name} ({item.assignmentCount} rings)
              </option>)}
            </select>
            <button type="button" disabled={!connected || templateBusy}
              onClick={() => void refreshTemplates().catch(cause => setError(String(cause)))}>Refresh Templates</button>
            <button type="button" disabled={!node.local || templateBusy || sessionBusy || !templateToLoad || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onClick={() => void loadTemplate()}>Apply Template</button>
            <button type="button" disabled={!node.local || templateBusy || sessionBusy || !session.eventId || activeRecordings.length > 0 || youtubeStreams.length > 0}
              onClick={() => void saveTemplate()}>Save Setup as Template</button>
          </div>
        </div>
        <div className="session-assignments">
          {visibleCameras.map((camera) => {
            const assignment = session.assignments.find((item) => item.cameraId === camera.id);
            const selectedMic = microphoneForCamera(camera);
            const assignedMic = selectedMic?.name ?? "";
            return <label className="field" key={camera.id}>
              <span>{labelFor(camera.id, camera.name)} ring assignment</span>
              <input value={assignment?.ring ?? ""} placeholder="e.g. Ring 1"
                disabled={!node.local || sessionBusy || activeRecordings.length > 0}
                onChange={(event) => setSession((old) => {
                  const rest = old.assignments.filter((item) => item.cameraId !== camera.id);
                  const ring = event.target.value;
                  return { ...old, assignments: ring ? [...rest, {
                    cameraId: camera.id, cameraName: camera.name,
                    microphoneName: assignedMic, microphoneId:selectedMic?.id, ring
                  }] : rest };
                })} />
            </label>;
          })}
        </div>
        <div className="camera-actions">
          <button type="button" disabled={!node.local || sessionBusy || activeRecordings.length > 0}
            onClick={() => void saveSession()}>Save Session</button>
          <button type="button" disabled={!node.local || sessionBusy || activeRecordings.length > 0}
            onClick={() => void createNewTournament()}>Create New Tournament ID</button>
          <button type="button" disabled={preflightBusy || !connected} onClick={() => void runPreflight()}>{preflightBusy ? "Checking..." : "Run preflight checks"}</button>
        </div>
        </div>
        <div className="camera-actions operator-bulk-actions" hidden={operatorView!=="live"}>
          <button type="button" className="primary-button" disabled={!node.local || sessionBusy || !connected ||
            !session.assignments.length || session.assignments.every(a=>activeRecordings.some(c=>c.cameraId===a.cameraId))}
            onClick={() => void bulkAction("start-all")}>Start All Recordings</button>
          <button type="button" className="danger-button"
            disabled={!node.local || sessionBusy || !connected || activeRecordings.length === 0}
            onClick={() => void bulkAction("stop-all")}>Stop All Recordings</button>
          <button type="button" className="primary-button"
            disabled={!node.local || sessionBusy || !connected || !session.assignments.length}
            onClick={() => void bulkYouTube("start-all")}>Start Assigned YouTube Streams</button>
          <button type="button" className="danger-button"
            disabled={!node.local || sessionBusy || !connected || youtubeStreams.length === 0}
            onClick={() => void bulkYouTube("stop-all")}>Stop All YouTube Streams</button>
        </div>
        <div className="session-results-grid">
        {devicesReady && session.assignments.some(a=>!devices.cameras.some(c=>c.id===a.cameraId) || (a.microphoneId ? !devices.microphones.some(m=>m.id===a.microphoneId) : devices.microphones.filter(m=>m.name===a.microphoneName).length!==1)) && <div className="bulk-results" aria-label="Assignment device validation">
          <strong>Assignment device check</strong>
          {session.assignments.map(a => {
            const cameraFound = devices.cameras.some(c => c.id === a.cameraId);
            const micFound = a.microphoneId ? devices.microphones.some(m=>m.id===a.microphoneId) : devices.microphones.filter(m => m.name === a.microphoneName).length===1;
            if (cameraFound && micFound) return null;
            return <div key={a.cameraId + a.ring}>
              <strong>{a.ring}</strong>: {cameraFound ? "Camera connected" : `Camera missing (${a.cameraName})`}
              {" / "}{micFound ? "Microphone connected" : `Microphone missing (${a.microphoneName})`}
              {!cameraFound && <label> Replace camera: <select aria-label={`Replacement camera for ${a.ring}`} value=""
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onChange={e => { if (e.target.value) replaceAssignmentCamera(a.cameraId, e.target.value); }}>
                <option value="">Choose connected camera</option>
                {devices.cameras.filter(c => !session.assignments.some(other => other.cameraId === c.id && other.cameraId !== a.cameraId))
                  .map(c => <option key={c.id} value={c.id}>{labelFor(c.id, c.name)}</option>)}
              </select></label>}
              {!micFound && <label> Replace microphone: <select aria-label={`Replacement microphone for ${a.ring}`} value=""
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onChange={e => { if (e.target.value) replaceAssignmentMicrophone(a.cameraId, e.target.value); }}>
                <option value="">Choose connected microphone</option>
                {devices.microphones.filter(m => !session.assignments.some(other => other.cameraId !== a.cameraId && (other.microphoneId ? other.microphoneId===m.id : other.microphoneName === m.name)))
                  .map(m => <option key={m.id} value={m.id}>{settings?.devices[m.id]?.alias || m.displayName || m.name}</option>)}
              </select></label>}
              {(!cameraFound || !micFound) && <button type="button"
                disabled={!node.local || sessionBusy || activeRecordings.length > 0 || youtubeStreams.length > 0}
                onClick={() => { setSession(old => ({ ...old, assignments: old.assignments.filter(item => item.cameraId !== a.cameraId) })); setPreflight(null); }}>
                Remove ring assignment</button>}
            </div>;
          })}
        </div>}
        {preflight && preflightDraft !== JSON.stringify(session) &&
          <p role="status">Assignments have changed since the last preflight. Run checks again.</p>}
        {preflight && preflightDraft === JSON.stringify(session) && <div className="bulk-results" role="status" aria-label="Preflight results">
          <strong>Preflight (current form): {preflight.ready ? "No blocking issues" : "Blocking issues found"}</strong>
          {preflight.checks.filter(check=>check.level!=="ok").map((check, index) => <div key={index}>
            {check.level === "error" ? "ERROR" : check.level === "warning" ? "WARNING" : "OK"}: {check.message}
          </div>)}
          <small className="muted">Device and disk checks only. Camera bandwidth and recording performance still require a live test.</small>
        </div>}
        {bulkResults.length > 0 && <div className="bulk-results" role="status">
          {bulkResults.map((line, index) => <div key={index}>{line}</div>)}
        </div>}
        </div>
      </section>

      <div className="operator-live-view" hidden={operatorView!=="live"}>
      <section className="overview" aria-label="Recording overview">
        <div className="metric"><span>Discovered cameras</span><strong>{visibleCameras.length}</strong></div>
        <div className="metric"><span>Active previews</span><strong>{previews.length}</strong></div>
        <div className="metric"><span>Recording</span><strong>{activeRecordings.length}</strong></div>
        <div className="metric"><span>YouTube relays</span><strong>{youtubeStreams.length}</strong></div>
        <div className="metric"><span>Healthy recordings</span><strong>{healthy} / {activeRecordings.length}</strong></div>
      </section>

      {storageHealth && (
        <p role="status" className={storageHealth.status === "healthy" ? "storage-healthy" : "camera-warning"}>
          Recording storage: {fileSize(storageHealth.freeBytes)} free.
          {storageHealth.status !== "healthy" && " Check disk capacity before starting more recordings."}
        </p>
      )}
      {storageError && <p role="alert" className="camera-warning">Recording storage status unavailable: {storageError}</p>}
      {captureHealth.some(item => item.status === "warning") && (
        <div className="alert" role="alert" aria-label="Recording health warnings">
          <strong>Recording health warnings</strong>
          {captureHealth.filter(item => item.status === "warning").map(item => (
            <p key={item.cameraId}>
              {labelFor(item.cameraId, item.cameraName)}: {item.warnings.join(" ")}
            </p>
          ))}
          <small>Monitoring only. Recordings are not restarted automatically.</small>
        </div>
      )}
      {activeRecordings.length > 0 && <p className="muted" role="status">
        Backend health: {captureHealth.filter(item => item.status === "healthy").length} healthy,
        {" "}{captureHealth.filter(item => item.status === "starting").length} starting,
        {" "}{captureHealth.filter(item => item.status === "warning").length} warning
      </p>}

      {recordingEvents.some((event) => event.type === "recording_failed") && (
        <details className="recording-event-panel">
          <summary>Recording interruptions ({recordingEvents.filter((event) => event.type === "recording_failed").length} since backend startup)</summary>
          {recordingEvents.filter((event) => event.type === "recording_failed").slice(0, 12).map((event, index) => (
            <p key={`${event.timestamp}-${index}`} className="camera-warning">
              {new Date(event.timestamp).toLocaleString()} · {labelFor(event.cameraId, event.cameraId)} · {event.detail}
            </p>
          ))}
        </details>
      )}
      {unhealthy.length > 0 && (
        <div className="alert" role="alert">
          Recording warning: {unhealthy.map((capture) => labelFor(capture.cameraId, capture.cameraName)).join(", ")}
        </div>
      )}

      <div className="section-heading">
        <h2>Cameras</h2>
        <button type="button" onClick={() => void refreshDevices()} disabled={devicesLoading}>
          {devicesLoading ? "Scanning..." : "Refresh Devices"}
        </button>
      </div>

      <div className="camera-grid">
        {visibleCameras.map((camera) => {
          const capture = captures.find((item) => item.cameraId === camera.id);
          const selectedStartMode = captureStartModes[camera.id] ?? "production";
          const diagnosticActive = capture?.outputMode === "diagnostic";

          const preview = previews.find((item) => item.cameraId === camera.id);
          const youtube = youtubeStreams.find((item) => item.cameraId === camera.id);
          const isPreviewing = Boolean(preview);
          const busy = busyIds.includes(camera.id);
          const expanded = expandedId === camera.id;
          const autoMic = microphoneForCamera(camera);
          const pairedId = autoMic?.id ?? "";
          const assignedMic = autoMic?.name ?? "";
          const micBusy = Boolean(assignedMic) && captures.some((item) =>
            item.cameraId !== camera.id && item.running && (item.microphoneName === pairedId || item.microphoneName === assignedMic));
          const frameAvailable = preview ? preview.previewAvailable : capture?.previewAvailable;
          const frozen = preview ? preview.previewFrozen : capture?.previewFrozen;
          const source = preview
            ? `${base}/api/previews/${encodeURIComponent(camera.id)}/frame`
            : `${base}/api/captures/${encodeURIComponent(camera.id)}/frame`;
          const sizeStalled = Boolean(capture && capture.recordingEnabled !== false && history[camera.id] &&
            now - history[camera.id].lastGrowthAt > 10000);
          const status = capture ? (frozen ? "Preview frozen" : capture.recordingEnabled === false ? (youtube ? "Streaming" : "Capture active") : sizeStalled ? "Recording stalled" : "Recording")
            : preview ? (preview.status === "error" ? "Preview error" :
              frozen ? "Preview frozen" : preview.status === "starting" ? "Starting preview" : "Previewing")
            : "Idle";
          return (
            <article className={`camera-card ${expanded ? "camera-card-expanded" : ""}`} key={camera.id}>
              <div className="camera-card-header">
                <strong>{labelFor(camera.id, camera.name)} ({camera.name})</strong>
                <span className={`camera-state ${capture ? "recording" : preview ? "previewing" : "idle"}`}>
                  {status}
                </span>
              </div>

              <div className="camera-preview">
                {frameAvailable ? (
                  <CameraPreviewImage source={source} alt={`${labelFor(camera.id, camera.name)} live preview`} />
                ) : (
                  <div className="camera-preview-placeholder">
                    {preview || capture ? "Waiting for video..." : "Preview inactive"}
                  </div>
                )}
              </div>

              {(frozen || sizeStalled || preview?.status === "error") && (
                <div className="camera-warning" role="alert">
                  {sizeStalled ? "Recording file has not grown for over 10 seconds." :
                    frozen ? "No new preview frames for over 3 seconds." :
                    "Preview process failed. Stop and restart preview."}
                  {preview?.status === "error" && preview.error && <details><summary>Technical details</summary><p>{preview.error}</p></details>}
                </div>
              )}

              <div className="camera-actions camera-primary-actions">
                <button type="button" disabled={!node.local || !connected || busy}
                  onClick={() => void togglePreview(camera, isPreviewing)}>
                  {busy ? "Working..." : isPreviewing ? "Stop Preview" : "Start Preview"}
                </button>
                <button type="button" className={capture?.recordingEnabled ? "danger-button" : "primary-button"}
                  disabled={!remoteCaptureAllowed || !connected || busy || (capture?.recordingEnabled === false && Boolean(youtube) && !(remoteCaptureAllowed && capture.recordingSwitchSupported)) || (!capture && (!assignedMic || micBusy))}
                  title={capture?.recordingSwitchSupported ? "Change recording without interrupting the stream." : capture?.recordingEnabled === false ? "Stop the stream before changing this capture to recording." : "Record this camera to disk."}
                  onClick={() => void toggleRecording(camera, capture)}>
                  {busy ? "Working..." : capture?.recordingEnabled ? "Stop Recording" : "Record"}
                </button>
                <button type="button" onClick={() => setExpandedId(expanded ? null : camera.id)}>
                  {expanded ? "Collapse" : "Identify"}
                </button>
                <button type="button" disabled={!remoteCaptureAllowed || busy || !connected ||
                  (!youtube && (diagnosticActive || (!capture && (!assignedMic || micBusy)) || (!streamKeys[camera.id]?.trim() && !savedProfiles[camera.id])))}
                  onClick={() => void toggleYouTube(camera.id, Boolean(youtube))}>
                  {youtube ? "Stop Stream" : "Start Stream"}
                </button>
              </div>

              <details className="device-details camera-settings-details">
                <summary>Camera settings and stream key</summary>
                {capture?.running && capture.recordingEnabled !== false && <button type="button" disabled={!node.local || !connected || busy}
                  onClick={() => void recoverRecording(camera)}>Restart Recording (5 min cooldown, max 2/hour)</button>}

              <div className="youtube-controls">
                <div className="youtube-heading">
                  <strong>YouTube Live</strong>
                  <span className={youtube?.status === "live" ? "youtube-live" : "muted"}>
                    {youtube ? (youtube.progressAgeMs !== null && youtube.progressAgeMs > 10000
                      ? "No recent output" : youtube.status) : "Offline"}
                  </span>
                </div>
                {!youtube && (
                  <label className="field">
                    <span>YouTube stream key</span>
                    <div className="key-input">
                      <input
                        type={showKeys[camera.id] ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={streamKeys[camera.id] ?? ""}
                        placeholder="Paste YouTube stream key"
                        onChange={(event) => setStreamKeys((old) =>
                          ({ ...old, [camera.id]: event.target.value }))}
                      />
                      <button type="button" onClick={() => setShowKeys((old) =>
                        ({ ...old, [camera.id]: !old[camera.id] }))}>
                        {showKeys[camera.id] ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                )}
                {!youtube && <div className="camera-actions">
                  <button type="button" disabled={!node.local || Boolean(savedProfiles[camera.id]) || !streamKeys[camera.id]?.trim()} onClick={() => void saveYouTubeKey(camera)}>{savedProfiles[camera.id] ? "Saved" : "Save key"}</button>
                  {savedProfiles[camera.id] && <button type="button" disabled={!node.local} onClick={() => void deleteYouTubeKey(camera.id)}>Forget key</button>}
                </div>}
                
                {diagnosticActive && <small className="camera-warning">Diagnostic YouTube relay is disabled pending ingest verification.</small>}
                {youtube?.error && <div className="camera-warning">{youtube.error}</div>}
              </div>

              <label className="field">
                <span>Microphone</span>
                <select value={pairedId ?? ""} disabled={!node.local || Boolean(capture)}
                  onChange={(event) => {
                    const microphoneId = event.target.value;
                    const microphoneName = devices.microphones.find(m => m.id === microphoneId)?.name ?? "";
                    editDevice(camera.id, { pairedMicrophoneId: microphoneId });
                    setMicrophones((old) => ({ ...old, [camera.id]: microphoneId }));
                    setSession((old) => ({ ...old, assignments: old.assignments.map((item) =>
                      item.cameraId === camera.id ? { ...item, microphoneName, microphoneId:microphoneId || undefined } : item) }));
                  }}>
                  <option value="">Select microphone</option>
                  {devices.microphones.map((mic, index) =>
                    <option key={mic.id} value={mic.id}>{settings?.devices[mic.id]?.alias || `${mic.name} #${index + 1}`}</option>)}
                </select>
              </label>
              {micBusy && <span className="camera-warning">Microphone in use by another recording</span>}

              </details>
              {capture && capture.recordingEnabled !== false && (
                <div className="recording-details">
                  <div><span>Duration</span><strong>{duration(capture.startedAt, now)}</strong></div>
                  <div><span>File size</span><strong>{fileSize(capture.recordingFileSize)}</strong></div>
                  <div><span>Frame count</span><strong>{capture.frameCount.toLocaleString()}</strong></div>
                  <div><span>File growth</span><strong>{history[camera.id]
                    ? `${Math.floor((now - history[camera.id].lastGrowthAt) / 1000)}s ago` : "Checking..."}</strong></div>
                  <p className="filename">Segments: {capture.segmentCount ?? 0} | Active: {capture.activeSegment?.split(/[\\/]/).pop() ?? "Starting"}</p>
                  <p className="filename" title={capture.recordingPath}>
                    {capture.recordingPath.split(/[\\/]/).pop()}
                  </p>
                </div>
              )}
              {!capture && preview && (
                <div className="camera-frame-stats">
                  <span>Source: {preview.source}</span>
                  <span>Frames: {preview.frameCount.toLocaleString()}</span>
                </div>
              )}
              <details className="device-details">
                <summary>Device details</summary>
                <p><strong>Model:</strong> {camera.name}</p>
                <p className="device-id">{camera.id}</p>
                <button type="button" onClick={() => void navigator.clipboard.writeText(camera.id)}>
                  Copy Device ID
                </button>
              </details>
            </article>
          );
        })}
      </div>
      {visibleCameras.length === 0 && <p className="muted">No cameras detected. Try Refresh Devices.</p>}

      {/* Operator tools: visible card sections, with individual tools expanded on demand. */}
      <details className="operator-advanced-shell" aria-label="Live Health" open>
        <summary>Live Health</summary>
        <div className="operator-tool-grid">
<details className="operator-tool-card" onToggle={e=>toggleTool("local-operations",e.currentTarget.open)}><summary>Live Ring Operations and CSV Report</summary>
      {operatorView==="live" && toolPanels["local-operations"] && <LiveOperationsPanel requestNode={requestNode} />}
        </details>
<details className="operator-tool-card" onToggle={e=>toggleTool("capture-signal",e.currentTarget.open)}><summary>Capture Signal Health</summary>
      {operatorView==="live" && toolPanels["capture-signal"] && node.local && <CaptureSignalHealthPanel requestNode={requestNode} nodeId={node.id} />}

        </details>
<details className="operator-tool-card" onToggle={e=>toggleTool("capture-recovery",e.currentTarget.open)}><summary>Capture Recovery and Restart Safeguards</summary>
      {operatorView==="live" && toolPanels["capture-recovery"] && node.local && <CaptureRecoveryPanel requestNode={requestNode} />}
        </details>
<details className="operator-tool-card" onToggle={e=>toggleTool("process-recovery",e.currentTarget.open)}><summary>FFmpeg Process Recovery and Relay Retries</summary>
      {operatorView==="live" && toolPanels["process-recovery"] && node.local && <ProcessRecoveryPanel requestNode={requestNode} />}
        </details>
<details className="operator-tool-card" onToggle={e=>toggleTool("capture-quality",e.currentTarget.open)}><summary>Capture and Streaming Quality</summary>
      {operatorView==="live" && toolPanels["capture-quality"] && node.local && <CaptureQualityPanel />}
        </details>

        <details className="operator-tool-card"><summary>Tournament Recording Summary</summary>
      <section aria-label="Tournament recording summary" className="overview">
        <div>
          <strong>Tournament recording summary</strong>{" "}
          <button type="button" disabled={!connected || summaryBusy}
            onClick={() => void refreshRecordingSummary()}>
            {summaryBusy ? "Calculating..." : "Refresh summary"}
          </button>
          {recordingSummary && <label> Event: <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
            <option value="">All recent sessions</option>
            {recordingSummary.events.map(event => <option key={event.eventId} value={event.eventId}>{event.eventName} ({event.eventId.split(":")[0]})</option>)}
          </select></label>}
          {summaryError && <p role="alert">{summaryError}</p>}
          {recordingSummary && <>
            <p>{recordingSummary.totals.sessions} sessions across {recordingSummary.cameras.length} cameras,
              {" "}{recordingSummary.totals.segments} segments, {fileSize(recordingSummary.totals.bytes)} total.
              {" "}{recordingSummary.totals.active} active, {recordingSummary.totals.failures} failed,
              {" "}{recordingSummary.totals.warnings} integrity warnings.</p>
            <p>Known recording duration: {(recordingSummary.totals.knownDurationSeconds / 3600).toFixed(2)} hours.
              {recordingSummary.totals.unknownDurationSessions > 0 &&
                ` ${recordingSummary.totals.unknownDurationSessions} sessions have unknown duration.`}</p>
            {recordingSummary.truncated && <p role="status">Only the latest 200 sessions are included.</p>}
            <p className="muted">Ring names are snapshots taken when recording began.
              {recordingSummary.unattributedSessions > 0 && ` ${recordingSummary.unattributedSessions} older or unassigned sessions lack event attribution.`}
              {" "}Events are grouped by name and recording start date, so same-name events on the same day share a group.
              Duration is elapsed session time, not verified playable footage.</p>
            <div style={{ overflowX: "auto" }}>
              <table><thead><tr><th>Ring / Camera</th><th>Sessions</th><th>Active</th>
                <th>Failures</th><th>Warnings</th><th>Segments</th><th>Storage</th><th>Known hours</th>
              </tr></thead><tbody>
                {recordingSummary.cameras.map(item => <tr key={item.cameraId}>
                  <td>{item.ring ? `${item.ring} / ` : ""}{item.cameraName}</td>
                  <td>{item.sessions}</td><td>{item.active}</td><td>{item.failures}</td>
                  <td>{item.warnings}</td><td>{item.segments}</td><td>{fileSize(item.bytes)}</td>
                  <td>{(item.knownDurationSeconds / 3600).toFixed(2)}</td>
                </tr>)}
              </tbody></table>
            </div>
          </>}
        </div>
      </section>


        </details>
        <details className="operator-tool-card"><summary>Recording Session History</summary>
      <section aria-label="Recording session history" className="overview">
        <div>
          <strong>Recording history and segment checks</strong>{" "}
          <button type="button" disabled={!connected || pastSessionsLoading}
            onClick={() => void refreshPastSessions()}>
            {pastSessionsLoading ? "Checking..." : "Refresh history"}
          </button>
          {" "}
          <button type="button" disabled={!connected || !node.local || reportBusy}
            onClick={() => void downloadRecordingReport("csv")}>Export CSV report</button>
          {" "}
          <button type="button" disabled={!connected || !node.local || reportBusy}
            onClick={() => void downloadRecordingReport("json")}>Export JSON diagnostics</button>
          {reportBusy && <span role="status">Preparing report...</span>}
          {pastSessionsError && <p role="alert">{pastSessionsError}</p>}
          {pastSessions.map((item, index) => <details key={`${item.startedAt}-${item.cameraId}-${index}`}>
            <summary>{item.eventName ? `${item.eventName} / ` : ""}{item.ring ? `${item.ring} / ` : ""}{item.cameraName} | {new Date(item.startedAt).toLocaleString()} | {item.outcome}
              {" "}| {item.integrity.status} | {item.integrity.segments.length} segments</summary>
            <p>Finished: {item.endedAt ? new Date(item.endedAt).toLocaleString() : "Not recorded"}</p>
            <p>Size: {fileSize(item.integrity.totalBytes ?? 0)}</p>
            {item.integrity.issues.map((issue, i) => <p key={i} role="alert">{issue}</p>)}
            {item.integrity.segments.map((segment) => <div key={segment.name}>
              {segment.name}: {fileSize(segment.bytes)}
            </div>)}
            <button type="button" disabled={!connected || validationBusy || item.outcome === "started"}
              onClick={() => void validateSession(item.recordingPath)}>
              {validationBusy ? "Validating..." : "Validate media with FFprobe"}
            </button>
            {validationResults[item.recordingPath] && <div role="status">
              <strong>Media validation: {validationResults[item.recordingPath].status}</strong>
              <p>Checked {validationResults[item.recordingPath].checked} of {validationResults[item.recordingPath].total} segments.</p>
              {validationResults[item.recordingPath].issues.map((issue, i) => <p key={i} role="alert">{issue}</p>)}
            </div>}
            <small>Basic checks above verify file size and sequence. FFprobe checks metadata and streams, not full video decoding.</small>
          </details>)}
        </div>
      </section>


        </details>
        <details className="operator-tool-card"><summary>Tournament-day Operations and Alerts</summary>
      <section className="session-panel" aria-label="Tournament day operations">
        <div className="section-heading"><h3>Tournament-day operations</h3>
          <span className="muted">Live node status · updates every 2 seconds</span></div>
        <p className="muted">One view of assigned rings, local recordings, YouTube relay status, and urgent warnings.
          An idle ring is not considered an error until the operator expects it to be active.</p>
        {!connected && <p role="alert" className="camera-warning">Node API disconnected. Displayed data may be stale.</p>}
        {storageHealth?.status === "critical" && <p role="alert" className="camera-warning">Critical recording storage: {fileSize(storageHealth.freeBytes)} remaining.</p>}
        {storageError && <p role="alert" className="camera-warning">Storage status unavailable: {storageError}</p>}
        <div className="overview">
          <div className="metric"><span>Assigned rings</span><strong>{session.assignments.length}</strong></div>
          <div className="metric"><span>Recording rings</span><strong>{session.assignments.filter(a => captures.some(c => c.cameraId === a.cameraId && c.running && c.recordingEnabled !== false)).length}</strong></div>
          <div className="metric"><span>Live relays</span><strong>{session.assignments.filter(a => youtubeStreams.some(y => y.cameraId === a.cameraId && y.status === "live")).length}</strong></div>
          <div className="metric"><span>Recording warnings</span><strong>{captureHealth.filter(h => h.status === "warning").length}</strong></div>
        </div>
        {session.assignments.length === 0 ? <p>No rings assigned in the current tournament session.</p> :
          <div style={{overflowX: "auto"}}><table>
            <thead><tr><th>Ring</th><th>Camera</th><th>Recording</th><th>YouTube</th><th>Preview</th><th>Alerts</th></tr></thead>
            <tbody>{session.assignments.map(assignment => {
              const capture = captures.find(c => c.cameraId === assignment.cameraId);
              const health = captureHealth.find(h => h.cameraId === assignment.cameraId);
              const stream = youtubeStreams.find(y => y.cameraId === assignment.cameraId);
              const present = devices.cameras.some(d => d.id === assignment.cameraId);
              const alerts = [
                !present ? "Camera not detected" : null,
                health?.status === "warning" ? health.warnings.join("; ") || "Recording warning" : null,
                capture?.previewFrozen ? "Preview frozen" : null,
                stream?.status === "error" ? stream.error || "YouTube relay error" : null,
                storageHealth?.status === "critical" ? "Storage critical" : null
              ].filter((value): value is string => Boolean(value));
              return <tr key={assignment.cameraId}>
                <td>{assignment.ring}</td><td>{labelFor(assignment.cameraId, assignment.cameraName)}</td>
                <td>{capture?.running && capture.recordingEnabled !== false ? `Recording · ${duration(capture.startedAt, now)}` : "Not recording"}</td>
                <td>{stream ? `${stream.status}${stream.progressAgeMs !== null ? ` · ${Math.round(stream.progressAgeMs / 1000)}s since progress` : ""}` : "Not live"}</td>
                <td>{capture?.previewFrozen ? "Frozen" : capture?.previewAvailable ? "Available" : "Unavailable"}</td>
                <td>{alerts.length ? <strong className="camera-warning" role="alert">{alerts.join("; ")}</strong> : "No detected alerts"}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        <p className="muted">Status reflects this node only. Remote nodes appear in their own read-only dashboard.
          A YouTube relay marked live indicates local relay progress, not independently verified public playback.</p>
      </section>

      <section className="session-panel" aria-label="Operations alert thresholds">
        <label>Warn when an active YouTube relay reports no progress for
          <select value={relayStaleSeconds} onChange={e => setRelayStaleSeconds(Number(e.target.value))}>
            {[15, 30, 60, 120].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select>
        </label>
        <p className="muted">This threshold applies only to relays reported as live, and measures reported local relay progress, not public YouTube playback.</p>
      </section>
      <section className="session-panel" aria-label="USB reliability alert integration">
        <h3>USB connection alerts</h3>
        <p className="muted">Connection warnings from the capture node are included in Operations alerts
          and the automatic critical incident workflow. Acknowledging an alert does not repair a camera.
          Counts are based on sampled history, not proof of a USB controller fault.</p>
        <p>{usbConnectionWarnings.length} active USB reliability warning(s).
          {!usbWarningsReady ? " Waiting for first successful analysis." : ""}</p>
        {usbWarningsError && <p className="camera-warning" role="status">
          USB reliability data may be stale: {usbWarningsError}
        </p>}
      </section>
      <OperationsAlertHistory nodeId={node.id} eventId={session.eventId || ""}
        alerts={operationsAlerts} online={alertSnapshotReady} />

        </details>

      
      </div>
      </details>
      </div>
      <div className="operator-workspace-view" hidden={operatorView!=="settings"}>
      <details className="operator-advanced-shell operator-settings-shell" aria-label="Advanced settings" open={operatorView==="settings"}>
        <summary>Settings</summary>
        <nav className="operator-navigation operator-settings-nav" aria-label="Settings categories">
          {([ ["devices","Devices & network"], ["hardware","Recording drive & hardware"], ["access","Access & licensing"] ] as const).map(([id,label])=><button type="button" key={id} aria-pressed={settingsView===id} className={settingsView===id?"operator-navigation-active":""} onClick={()=>setSettingsView(id)}>{label}</button>)}
        </nav>
      <div hidden={settingsView!=="access"}>
      {operatorView==="settings" && settingsView==="access" && <>
      <DistributedOwnershipPanel requestNode={requestNode} connected={connected} />
      {!node.local && <DistributedRemoteControls key={node.id} nodeName={node.name} connected={connected} enabled={remoteCaptureControlsEnabled} requestNode={requestNode} cameraIds={session.assignments.map(assignment => assignment.cameraId)} />}
      <EventPassPanel requestNode={requestNode} local={node.local} />
      </>}
      </div>
      <div hidden={settingsView!=="hardware"}>
      {operatorView==="settings" && settingsView==="hardware" && <HardwareReadinessPanel requestNode={requestNode} local={node.local} />}
      {operatorView==="settings" && settingsView==="hardware" && node.local && <FleetReadinessPanel />}
      </div>
      <div hidden={settingsView!=="devices"}>
      {!node.local && <section className="operator-tool-card" aria-label="Remote capture controls">
        <label><input type="checkbox" checked={remoteCaptureControlsEnabled}
          onChange={e => {
            if (e.target.checked && !window.confirm(`Enable remote capture controls for ${node.name}? Commands may start or stop live streams and recordings.`)) return;
            setRemoteCaptureControlsEnabled(e.target.checked);
          }} /> Enable remote capture controls for {node.name}</label>
        <p className="muted">Off by default. Requires operator authentication on the host. Do not retry timed-out start or stop commands without checking the node's current status.</p>
      </section>}
      {node.local && settings && <details className="session-panel settings-panel compact-collapsible">
        <summary>Device and network settings</summary>
        <div className="section-heading"><h3>Configuration</h3>
          <button type="button" onClick={() => setShowDeviceManager((value) => !value)}>
            {showDeviceManager ? "Close device manager" : "Manage cameras and microphones"}
          </button>
        </div>
        <p className="muted">Hidden devices stay installed in Windows. Settings are stored by the backend and survive restarts.</p>
        {showDeviceManager && <div className="device-manager">
          {allDevices.map((device) => {
            const preference = settings.devices[device.id] ?? {};
            return <div className="device-manager-row" key={device.id}>
              <div><strong>{device.kind === "video" ? "Camera" : "Microphone"}: {device.displayName || device.name}</strong>
                <small className="muted device-id">{device.id}</small></div>
              <label className="field"><span>Friendly name</span>
                <input value={preference.alias ?? ""} placeholder={device.name}
                  onChange={(e) => editDevice(device.id, {alias: e.target.value})}/></label>
              {device.kind === "video" && <label className="field"><span>Paired microphone</span>
                <select value={preference.pairedMicrophoneId ?? ""} onChange={(e) => editDevice(device.id, {pairedMicrophoneId: e.target.value})}>
                  <option value="">Not paired</option>
                  {allDevices.filter((item) => item.kind === "audio").map((mic) =>
                    <option key={mic.id} value={mic.id}>{settings.devices[mic.id]?.alias || mic.displayName || mic.name}</option>)}
                </select></label>}
              <label className="device-toggle"><input type="checkbox" checked={preference.hidden === true}
                onChange={(e) => editDevice(device.id, {hidden: e.target.checked})}/> Hide</label>
            </div>;
          })}
          <button type="button" onClick={() => setSettings((old) => old ? ({...old, devices: Object.fromEntries(
            Object.entries(old.devices).map(([id, pref]) => [id, {...pref, hidden: false}]))}) : old)}>Restore all hidden devices</button>
        </div>}
        <div className="settings-network">
          <label className="field"><span>Network mode</span>
            <select value={settings.network.mode} onChange={(e) => setSettings((old) => old ? ({...old, network: {...old.network, mode: e.target.value as AppSettings["network"]["mode"]}}) : old)}>
              <option value="offline">Offline (localhost only)</option><option value="tailscale">Tailscale interface</option><option value="lan">Selected LAN interface</option>
            </select></label>
          <label className="field"><span>Bind address (requires backend restart)</span>
            <input value={settings.network.bindAddress} placeholder="127.0.0.1"
              onChange={(e) => setSettings((old) => old ? ({...old, network: {...old.network, bindAddress: e.target.value}}) : old)}/></label>
        </div>
        {networkStatus && <p role="status" style={{color: networkStatus.remote.state === "unavailable" ? "#d97706" : undefined}}>
          <strong>Remote access: {networkStatus.remote.state === "listening" ? "Listening" : networkStatus.remote.state === "unavailable" ? "Unavailable" : networkStatus.remote.state === "starting" ? "Starting" : "Disabled"}.</strong>{" "}
          {networkStatus.remote.message} Local dashboard remains available at {networkStatus.local.address}.
          {networkStatus.remote.state === "unavailable" && " Change the network settings above and save, then restart the backend."}
        </p>}
        <p className="muted">Offline mode does not start remote-node connections. YouTube streaming is separately controlled. Tailscale/LAN mode requires the exact IP of the intended network interface.</p>
        <div className="camera-actions"><button type="button" className="primary-button" disabled={settingsBusy} onClick={() => void saveSettings()}>Save settings</button>
          <button type="button" onClick={() => void downloadBackup()}>Download configuration backup</button></div>
        <div className="camera-actions"><label className="field"><span>Restore backup JSON</span>
          <input type="file" accept=".json,application/json" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}/></label>
          <button type="button" disabled={!restoreFile || settingsBusy || activeRecordings.length > 0} onClick={() => void restoreBackup()}>Restore backup</button></div>
        {settingsMessage && <p role="status">{settingsMessage}</p>}
      </details>}
      </div>
      </details>
      </div>
      <div className="operator-workspace-view" hidden={operatorView!=="maintenance"}>
      {operatorView==="maintenance" && <>
      <details className="operator-advanced-shell" aria-label="Advanced tools and reports" open={operatorView==="maintenance"}>
        <summary>Advanced Tools</summary>
      <section className="operator-workspace" aria-label="Testing & Diagnostics">
        <div className="operator-workspace-title"><h2>Testing & Diagnostics</h2><p>One testing report and individual test controls</p></div>
        <div className="operator-tool-grid">
        <div className="test-report" aria-label="Unified testing report">
          <div className="test-report-heading">
            <div><h3>Testing report</h3><p>One overview of the latest readiness, encoder, equipment and stress-test results. Each result retains its own collection time.</p></div>
            <button type="button" onClick={() => {
              const report = {
                exportedAt: new Date().toISOString(), eventId: session.eventId || null, eventName: session.eventName,
                nodeId: node.id, readiness, encoderStats, stressResults, stressResources, equipmentTests,
                limitations: ["Results are from separate checks and may not represent the same point in time.", "Stress-test preview FPS is not encoded recording FPS."]
              };
              const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: "application/json"}));
              const link = document.createElement("a"); link.href = url; link.download = `tournament-testing-${new Date().toISOString().slice(0,10)}.json`; link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>Export combined report (JSON)</button>
          </div>
          <div className="test-report-metrics">
            <div><strong>Readiness</strong><span>{!readiness ? "Not checked" : readiness.blockers.length ? `${readiness.blockers.length} blockers` : readiness.warnings.length ? `${readiness.warnings.length} warnings` : "Ready"}</span></div>
            <div><strong>Encoder</strong><span>{!encoderStats ? "Not checked" : `${encoderStats.captures.length} active captures`}</span></div>
            <div><strong>Stress test</strong><span>{!stressResults ? "Not run" : `${stressResults.filter(item => item.status === "pass").length}/${stressResults.length} passed`}</span></div>
            <div><strong>Equipment</strong><span>{`${Object.keys(equipmentTests).length} tested`}</span></div>
          </div>
          <p className="muted">Use the cards below to run individual checks. This report summarizes existing results; it does not start or stop recordings.</p>
        </div>


        <details className="operator-tool-card"><summary>System Resource Monitor and USB Diagnostics</summary>
      {node.local && <SystemResourceMonitor requestNode={requestNode} />}
      {node.local && <>
        <UsbTopologyDiagnostics requestNode={requestNode} nodeId={node.id} />
        <CameraAssetInventory nodeId={node.id} />
        <UsbBandwidthPlanner requestNode={requestNode} stressResults={stressResults} stressBusy={stressBusy} />
      </>}

        </details>

      
        

<details className="operator-tool-card"><summary>FFmpeg Encoder Diagnostics</summary>
      <section aria-label="FFmpeg encoder diagnostics" className="overview">
        <h2>FFmpeg Encoder Diagnostics</h2>
        <p>FFmpeg's reported encoding FPS, processing speed, dropped-frame count and bitrate for each running capture process.
          Because each capture produces recording, preview, and relay outputs, these figures are aggregate process statistics,
          not verified recording-only FPS. The recording input is currently configured for 1080p30.</p>
        <button type="button" disabled={!connected || encoderStatsBusy}
          onClick={() => void refreshEncoderStats()}>
          {encoderStatsBusy ? "Checking..." : "Refresh Encoder Diagnostics"}
        </button>
        {encoderStatsError && <p role="alert">{encoderStatsError}</p>}
        {encoderStats && <div className="bulk-results" role="status">
          <small>Snapshot: {new Date(encoderStats.checkedAt).toLocaleTimeString()}</small>
          {encoderStats.captures.length === 0 && <p>No active recordings.</p>}
          {encoderStats.captures.map(item => <p key={item.cameraId}>
            <strong>{item.cameraName}</strong>: {item.encoder ?
              `FPS ${item.encoder.fps?.toFixed(1) ?? "N/A"} | Speed ${item.encoder.speed?.toFixed(2) ?? "N/A"}x | Dropped ${item.encoder.droppedFrames ?? "N/A"} | Bitrate ${item.encoder.bitrateKbps?.toFixed(0) ?? "N/A"} kb/s | Sample age ${Math.round(item.encoder.ageMs / 1000)}s` :
              "Waiting for FFmpeg progress data"}
            {item.encoder && (item.encoder.ageMs > 10000 || (item.encoder.speed !== null && item.encoder.speed < 0.9)) &&
              <span> | WARNING: encoder may be falling behind</span>}
          </p>)}
          <small>Refresh to sample again. A single snapshot cannot establish sustained frame loss; use the 30-second stress test alongside this view.</small>
        </div>}
      </section>


        </details>
<details className="operator-tool-card"><summary>Multi-Camera Recording Stress Test</summary>
      <section aria-label="Multi-camera recording stress test" className="overview">
        <h2>Multi-Camera Recording Stress Test</h2>
        <p>Start local recordings on at least two cameras, then monitor all active recordings together for 30 seconds.
          This does not start or stop cameras, change YouTube streams, or save additional test footage.
          Frame rate below is the 5 fps preview sampling rate, not the 30/60 fps encoded recording rate.
          This is a recording pipeline test, not a direct USB bandwidth measurement.</p>
        <button type="button" disabled={!connected || !node.local || stressBusy}
          onClick={() => void runCameraStressTest()}>
          {stressBusy ? `Testing... ${stressProgress}/30 seconds` : "Run 30-second multi-camera test"}
        </button>
        {stressError && <p role="alert">{stressError}</p>}
        {stressResults && <div className="bulk-results" role="status">
          <strong>Results: {stressResults.filter(item => item.status === "pass").length}/{stressResults.length} passed</strong>
          {stressResults.map(item => <p key={item.cameraId}>
            <strong>{item.cameraName}: {item.status.toUpperCase()}</strong>
            {` | Preview: ${item.observedFps.toFixed(1)} fps | File growth: ${item.growthBytes === null ? "unknown" : fileSize(item.growthBytes)}`}
            {` | Stale frames: ${item.staleSamples} | Missing samples: ${item.missingSamples}`}
            {item.restarted ? " | Recording restarted during test" : ""}
          </p>)}
          <small>Results reflect only the 30-second sample window. Check recorded files with FFprobe separately.</small>
        </div>}
        {stressResources && <>
          <StressResourceSummary report={stressResources} cameraResults={stressResults || []} />
          <div className="bulk-results">
            <strong>Export completed stress test</strong>
            <p>JSON includes full camera results and timestamped resource readings. CSV contains
              camera and resource rows with a recordType column for filtering and comparison.</p>
            <button type="button" disabled={stressBusy || !stressResults}
              onClick={() => exportStressReport("json")}>Download stress test JSON</button>
            <button type="button" disabled={stressBusy || !stressResults}
              onClick={() => exportStressReport("csv")}>Download stress test CSV</button>
          </div>
        </>}
        <div className="bulk-results" aria-label="Compare saved stress test reports">
          <h3>Compare saved stress tests</h3>
          <p>Import up to 12 milestone 43 JSON reports to compare camera outcomes and average system load.
            Files stay in this browser session and are not uploaded. CSV exports are not supported here.</p>
          <div className="bulk-results" aria-label="Persistent stress test history">
            <h3>Saved test history</h3>
            <p>Completed tests are automatically saved in this browser, up to 30 entries.
              Give the next test a configuration label, such as “PCIe card: 3 cameras, 1080p60”.
              Browser data can be cleared, so export JSON for durable backups.</p>
            <label>Next test label <input type="text" maxLength={100} value={historyLabel}
              onChange={event => setHistoryLabel(event.target.value)}
              placeholder="e.g. 8 cameras, PCIe card, high quality" /></label>
            {historyError && <p role="alert">{historyError}</p>}
            {savedStressReports.length > 0 && <>
              <button type="button" onClick={() => {
                if (window.confirm("Delete all saved stress-test history from this browser?"))
                  updateStressHistory(() => []);
              }}>Clear saved history</button>
              <div style={{ overflowX: "auto" }}><table><thead><tr><th>Configuration label</th>
                <th>Started</th><th>Cameras</th><th>Failures</th><th>Actions</th></tr></thead><tbody>
                {savedStressReports.slice().reverse().map(entry => <tr key={entry.id}>
                  <td><input aria-label={`Label for ${entry.filename}`} value={entry.label} maxLength={100}
                    onChange={event => updateStressHistory(previous => previous.map(item =>
                      item.id === entry.id ? { ...item, label: event.target.value } : item))} /></td>
                  <td>{entry.report.startedAt}</td><td>{entry.report.cameraResults.length}</td>
                  <td>{entry.report.cameraResults.filter(camera => camera.status === "failed").length}</td>
                  <td><button type="button" onClick={() => setComparisonReports(previous =>
                    [...previous, { filename: entry.label, report: entry.report }].slice(-12))}>Compare</button>{" "}
                    <button type="button" onClick={() => updateStressHistory(previous =>
                      previous.filter(item => item.id !== entry.id))}>Delete</button></td>
                </tr>)}</tbody></table></div>
            </>}
          </div>
          <label>Import stress-test JSON reports <input type="file" accept=".json,application/json" multiple
            onChange={event => { void importStressReports(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>
          {comparisonError && <pre role="alert">{comparisonError}</pre>}
          {comparisonReports.length > 0 && <>
            <button type="button" onClick={() => setComparisonReports([])}>Clear comparisons</button>
            <div style={{ overflowX: "auto" }}><table>
              <thead><tr><th>Report</th><th>Started</th><th>Cameras</th><th>Pass</th><th>Warning</th><th>Failed</th>
                <th>Avg preview FPS</th><th>Avg CPU</th><th>Avg GPU</th><th>Avg disk writes</th></tr></thead>
              <tbody>{comparisonReports.map(({ filename, report }, index) => {
                const metrics = summarizeComparison(report);
                return <tr key={`${filename}-${index}`}><td>{filename}</td><td>{report.startedAt}</td>
                  <td>{metrics.count}</td><td>{metrics.passes}</td><td>{metrics.warnings}</td><td>{metrics.failed}</td>
                  <td>{metrics.averagePreviewFps === null ? "n/a" : metrics.averagePreviewFps.toFixed(1)}</td>
                  <td>{metrics.cpu === null ? "n/a" : `${metrics.cpu.toFixed(1)}%`}</td>
                  <td>{metrics.gpu === null ? "n/a" : `${metrics.gpu.toFixed(1)}%`}</td>
                  <td>{metrics.disk === null ? "n/a" : `${(metrics.disk / 1_000_000).toFixed(1)} MB/s`}</td>
                </tr>;
              })}</tbody>
            </table></div>
            <p>Compare like-for-like tests with the same camera count, duration, scene, and recording settings.
              Preview FPS is not encoded FPS. CPU/GPU/disk counters are system-wide and do not prove causation.</p>
          </>}
        </div>
      </section>


        </details>
<details className="operator-tool-card"><summary>Camera and Microphone Test Mode</summary>
      <section aria-label="Camera and microphone test mode" className="overview">
        <h2>Camera and Microphone Test Mode</h2>
        <p>Start a camera preview to verify live video. Speak into the microphone during the three-second audio test.
          No test audio is recorded or uploaded.</p>
        {equipmentTestError && <p role="alert">{equipmentTestError}</p>}
        {session.assignments.length === 0 && <p>Assign cameras to rings to enable equipment testing.</p>}
        {session.assignments.map(assignment => {
          const result = equipmentTests[assignment.cameraId];
          const current = result?.microphoneName === assignment.microphoneName ? result : null;
          return <div key={assignment.cameraId + assignment.ring} className="bulk-results">
            <strong>{assignment.ring}: {assignment.cameraName}</strong> ({assignment.microphoneName}){" "}
            <button type="button" disabled={!connected || !node.local || equipmentTesting !== null}
              onClick={() => void testRingEquipment(assignment)}>
              {equipmentTesting === assignment.cameraId ? "Testing..." : "Test Camera and Microphone"}
            </button>
            {current && <div role="status">
              <p>Video: {current.video.status.toUpperCase()}. {current.video.message}</p>
              <p>Microphone: {current.audio.status.toUpperCase()}. {current.audio.message}
                {current.audio.maxDb !== null && ` Peak: ${current.audio.maxDb.toFixed(1)} dBFS.`}</p>
              <small>Tested {new Date(current.checkedAt).toLocaleTimeString()}. Results are a snapshot.</small>
            </div>}
          </div>;
        })}
      </section>


        </details>
        

      </div>
      </section>
      <section className="operator-workspace" aria-label="Incident Management">
        <div className="operator-workspace-title"><h2>Incident Management</h2><p>Timeline, failure investigation and recovery evidence</p></div>
        <div className="operator-tool-grid">

        <p className="muted">Record incidents, review the shared chronology and investigate related camera, USB and recording failures. The underlying evidence is preserved.</p>
        <details className="operator-tool-card"><summary>Incident Log and Resolution</summary>
          <IncidentLog key={`${node.id}:${session.eventId || "unsaved"}`} nodeId={node.id}
            eventId={session.eventId || ""} alerts={operationsAlerts}
            online={alertSnapshotReady} />
        </details>
        <details className="operator-tool-card"><summary>Event Timeline and Incident Patterns</summary>
          <IncidentTimeline key={`timeline:${node.id}:${session.eventId || "unsaved"}`}
            nodeId={node.id} eventId={session.eventId || ""} />
          <details className="compact-collapsible"><summary>Trends by Time</summary>
            <IncidentTrends key={`trends:${node.id}:${session.eventId || "unsaved"}`}
              nodeId={node.id} eventId={session.eventId || ""} />
          </details>
          <details className="compact-collapsible"><summary>Patterns by Ring and Category</summary>
            <IncidentAnalytics key={`analytics:${node.id}:${session.eventId || "unsaved"}`}
              nodeId={node.id} eventId={session.eventId || ""} />
            <IncidentHeatmap key={`heatmap:${node.id}:${session.eventId || "unsaved"}`}
              nodeId={node.id} eventId={session.eventId || ""} />
          </details>
        </details>
        <details className="operator-tool-card"><summary>Failure Investigation and Correlation</summary>
          <FailureInvestigationPanel requestNode={requestNode} />
          <details className="compact-collapsible"><summary>USB and Recording Correlation</summary>
            <UsbRecordingCorrelationPanel requestNode={requestNode} />
          </details>
          <details className="compact-collapsible"><summary>Camera Disconnections</summary>
            <CameraDisconnectionAnalysis requestNode={requestNode} />
          </details>
        </details>
        <details className="operator-tool-card"><summary>Guided Troubleshooting</summary>
          <CameraTroubleshootingPanel requestNode={requestNode} />
          <GuidedTroubleshootingTests />
        </details>
      
      </div>
      </section>
      <section className="operator-workspace" aria-label="Tournament Readiness">
        <div className="operator-workspace-title"><h2>Tournament Readiness</h2><p>Pre-event checks, hardware and reliability</p></div>
        <div className="operator-tool-grid"><details className="operator-tool-card"><summary>Tournament Readiness</summary>
      <section aria-label="Tournament readiness" className="overview">
        <h2>Tournament Readiness</h2>
        <p>Snapshot of unsaved assignments, connected devices, recording disk, recording health, and YouTube relay status.</p>
        <button type="button" disabled={!connected || readinessBusy}
          onClick={() => void checkTournamentReadiness()}>
          {readinessBusy ? "Checking readiness..." : "Check Tournament Readiness"}
        </button>
        {readinessError && <p role="alert">Readiness check failed: {readinessError}</p>}
        {readiness && readinessDraft !== JSON.stringify(session) &&
          <p role="alert">Assignments changed since the last readiness check. Run it again.</p>}
        {readiness && readinessDraft === JSON.stringify(session) && (
          <div className="bulk-results" role="status">
            <strong>{readiness.blockers.length ? "NOT READY" :
              readiness.warnings.length ? "READY WITH WARNINGS" : "CONFIGURATION READY"}</strong>
            <p>Checked: {new Date(readiness.checkedAt).toLocaleString()}.
              Point-in-time check only. Does not test USB bandwidth or YouTube connectivity.</p>
            <p>Storage: {readiness.storage ?
              `${fileSize(readiness.storage.freeBytes)} free (${readiness.storage.status})` :
              `Unavailable (${readiness.storageError || "unknown error"})`}</p>
            {readiness.blockers.map((item, i) => <p key={`block-${i}`}>BLOCKER: {item}</p>)}
            {readiness.warnings.map((item, i) => <p key={`warn-${i}`}>WARNING: {item}</p>)}
            {readiness.rings.filter(item=>item.issues.length>0).map((item, i) => <div key={`${item.ring}-${i}`}>
              <strong>{item.ring || `Assignment ${i + 1}`}</strong>: {item.camera}
              {" | Camera: "}{item.cameraConnected ? "connected" : "MISSING"}
              {" | Mic: "}{item.microphoneConnected ? "connected" : "MISSING"}
              {" | Recording: "}{item.recording ? (item.recordingHealthy === false ? "warning" : "active") : "stopped"}
              {" | YouTube: "}{item.youtubeLive ? "live" : "not live"}
              {item.issues.length > 0 && <span> | Issues: {item.issues.join("; ")}</span>}
            </div>)}
          </div>
        )}
      </section>

      <TournamentHardwareReport requestNode={requestNode} nodeId={node.id}
        eventName={session.eventName} eventId={session.eventId || null}
        assignments={session.assignments} readiness={readiness}
        readinessCurrent={readinessDraft === JSON.stringify(session)}
        latestStress={savedStressReports.length ? savedStressReports[savedStressReports.length - 1] : null}
        equipmentTests={equipmentTests} />


        </details>


        <p className="muted">Current camera condition, connection history and reliability warnings in one workspace.</p>
        <details className="operator-tool-card"><summary>Camera Health and Connection History</summary>
          <CameraHealthPanel requestNode={requestNode} />
          <details className="compact-collapsible"><summary>Connection History</summary>
            <CameraHealthHistoryPanel requestNode={requestNode} />
          </details>
        </details>
        <details className="operator-tool-card"><summary>Reliability Warnings</summary>
          <ReliabilityWarningsPanel requestNode={requestNode} />
          <UsbReliabilityWarningsPanel requestNode={requestNode} />
        </details>
        <details className="operator-tool-card"><summary>Configuration Reliability and Camera Breakdown</summary>
          <RecordingConfigurationReliabilityPanel requestNode={requestNode} />
          <CameraConfigurationReliabilityPanel requestNode={requestNode} />
          <CameraReliabilityDashboard requestNode={requestNode} />
        </details>
        <details className="operator-tool-card"><summary>Tournament Readiness and Launch Guide</summary>
          <TournamentReadinessOverview requestNode={requestNode} readiness={readiness}
            readinessCurrent={readinessDraft === JSON.stringify(session)} captures={captures}
            streamCount={youtubeStreams.length} nodeId={node.id} eventId={session.eventId || "unsaved"}
            assignments={session.assignments} />
          <TournamentLaunchShutdownGuide nodeId={node.id} eventId={session.eventId || "unsaved"}
            assignments={session.assignments} captures={captures} streams={youtubeStreams} requestNode={requestNode} />
        </details>
      
      </div>
      </section>
      <section className="operator-workspace" aria-label="Reports & History">
        <div className="operator-workspace-title"><h2>Reports & History</h2><p>Event reports, comparisons and archives</p></div>
        <div className="operator-tool-grid">

        <p className="muted">Technical summaries, incident patterns and comparisons are collected here rather than scattered through the incident log.</p>
        <details className="operator-tool-card"><summary>Technical Report and Event Summary</summary>
          <PostTournamentTechnicalReport key={`post-report:${node.id}:${session.eventId || "unsaved"}`}
            nodeId={node.id} eventId={session.eventId || ""} eventName={session.eventName || ""}
            requestNode={requestNode} />
          <details className="compact-collapsible"><summary>Technical Summary</summary>
            <TournamentTechnicalSummary key={`summary:${node.id}:${session.eventId || "unsaved"}`}
              nodeId={node.id} eventId={session.eventId || ""} eventName={session.eventName || ""}
              requestNode={requestNode} />
          </details>
        </details>
        <details className="operator-tool-card"><summary>Historical Comparisons and Reliability Trends</summary>
          <TournamentToTournamentComparison />
          <TournamentReliabilityTrends />
        </details>
        <details className="operator-tool-card"><summary>Report Archive</summary>
          <TournamentReportArchive />
        </details>
      
      </div>
      </section>
      </details>
       </>}
      </div>
    </section>
  );
}

export default function App() {
  const [fleetMonitoringOpen, setFleetMonitoringOpen] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [authError, setAuthError] = useState("");
  useEffect(() => { void request("/api/auth/status").then((data) => {
    setAuthConfigured(Boolean(data.configured)); setUnlocked(Boolean(data.unlocked));
  }).catch(() => {}); }, []);
  async function unlock() {
    try {
      const data = await request("/api/auth/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword })
      });
      operatorApi.setToken(data.token); setUnlocked(true); setAdminPassword(""); setAuthError("");
    } catch (error) { setAuthError(String(error)); }
  }
  async function lock() {
    try { await request("/api/auth/lock", { method: "POST" }); } catch { /* expire locally regardless */ }
    operatorApi.setToken(""); setUnlocked(false);
  }
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result: { nodes: NodeInfo[] } = await request("/api/nodes");
        if (active) { setNodes(previous => JSON.stringify(previous) === JSON.stringify(result.nodes) ? previous : result.nodes); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const timer = startPolling(refresh, 5000);
    return () => { active = false; timer(); };
  }, []);

  // Offline nodes have no mounted NodeDashboard, so report them from the root.
  const offlineNodeSignature = JSON.stringify(nodes.filter(node => !node.online).map(node => ({ id: node.id, name: node.name })));
  useEffect(() => {
    const offlineNodes = JSON.parse(offlineNodeSignature) as Array<{ id: string; name: string }>;
    for (const node of offlineNodes) {
      window.dispatchEvent(new CustomEvent("tournament:operations-alerts", {
        detail: { nodeId: node.id, nodeName: node.name, online: false,
          alerts: [{ key: "node-offline", severity: "critical", message: `${node.name} is unreachable; stream status cannot be verified` }] }
      }));
    }
  }, [offlineNodeSignature]);
  return (
    <main className="dashboard">
      <GlobalNotifications />
      <header className="dashboard-header">
        <div>
          <h1>Tournament Streaming</h1>
          <p className="muted">Multi-PC tournament control center</p>
        </div>
        <strong>{nodes.filter((node) => node.online).length} / {nodes.length} nodes connected</strong>
      </header>
      {authConfigured && <section className="operator-panel" aria-label="Operator permissions">
        <strong>{unlocked ? "Operator unlocked (15-minute grant)" : "Read-only: operator locked"}</strong>
        {unlocked ? <button type="button" onClick={() => void lock()}>Lock controls</button> :
          <form onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
            <input type="password" autoComplete="current-password" placeholder="Operator password"
              aria-label="Operator password" value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)} />
            <button type="submit">Unlock controls</button>
          </form>}
        {authError && <span role="alert">{authError}</span>}
      </section>}
      {error && <OperatorErrorNotice message={error} />}
      {nodes.map((node) => (
        <div key={node.id} className="node-container">
          {!node.online && <div className="node-indicator offline"><span className="status-dot" /> Disconnected</div>}
          {node.online ? <NodeDashboard node={node} /> : (
            <div className="node-offline">
              <strong>{node.name} is unreachable.</strong>
              <p>Its local recordings and streams may still be running. Control will return when the connection recovers.</p>
            </div>
          )}
        </div>
      ))}
      <details className="operator-advanced-shell" aria-label="Fleet monitoring details" onToggle={e => setFleetMonitoringOpen(e.currentTarget.open)}>
        <summary>Fleet Monitoring</summary>
      {fleetMonitoringOpen && <>
        <FleetOperationsPanel nodes={nodes} request={request} />
        <PlaybackObservationPanel request={request} />
        <YouTubePlatformHealthPanel request={request} />
      </>}
      </details>
    </main>
  );
}
