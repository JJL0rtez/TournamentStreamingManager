import { operatorApi } from "./operator-api";
import { type SystemResourceSnapshot } from "./SystemResources";

export interface MediaDevice {
  kind: "video" | "audio";
  name: string;
  id: string;
  displayName?: string;
  hidden?: boolean;
}

export interface DeviceList {
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  allDevices?: MediaDevice[];
}

export interface DevicePreference { alias?: string; hidden?: boolean; pairedMicrophoneId?: string }

export interface NetworkStatus { local: { available: boolean; address: string }; remote: { state: "disabled" | "listening" | "unavailable" | "starting"; address: string | null; message: string } }

export interface AppSettings { version: 1; network: { mode: "offline" | "tailscale" | "lan"; bindAddress: string }; devices: Record<string, DevicePreference> }

export interface CaptureQuality {
  inputWidth: number; inputHeight: number; inputFps: number;
  recordingFps: number; recordingBitrate: string;
  streamingWidth: number; streamingHeight: number;
  streamingFps: number; streamingBitrate: string; previewFps: number;
}

export interface Capture {
  outputMode?: "production" | "diagnostic";
  recordingEnabled?: boolean;
  recordingSwitchSupported?: boolean;
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  recordingPath: string;
  selectedMode?: { width: number; height: number; fps: number } | null;
  running: boolean;
  previewAvailable: boolean;
  startedAt: string;
  frameCount: number;
  frameAgeMs: number | null;
  previewFrozen: boolean;
  recordingFileSize: number | null;
  segmentCount?: number;
  activeSegment?: string | null;
  recordingSegments?: Array<{ path: string; bytes: number; modifiedAt: string }>;
}

export interface Preview {
  cameraId: string;
  status: "starting" | "running" | "stopped" | "error";
  source: "recording" | "standalone";
  previewAvailable: boolean;
  frameCount: number;
  frameAgeMs: number | null;
  previewFrozen: boolean;
  error?: string | null;
}

export interface PreflightResult { source?: "saved" | "draft"; ready: boolean; checks: { level: "ok" | "warning" | "error"; message: string }[]; checkedAt: string }

export interface EncoderStatsSnapshot {
  checkedAt: number;
  captures: Array<{ cameraId: string; cameraName: string; startedAt: string;
    running: boolean; encoder: null | { updatedAt: number; ageMs: number;
      frame: number | null; fps: number | null; speed: number | null;
      droppedFrames: number | null; bitrateKbps: number | null; outTimeMs: number | null } }>;
}

export interface StressSnapshot {
  checkedAt: number;
  captures: Array<{ cameraId: string; cameraName: string; startedAt: string;
    running: boolean; frameCount: number; frameAgeMs: number | null;
    recordingBytes: number | null; segmentCount: number }>;
}

export interface StressResourceReport {
  readings: SystemResourceSnapshot[];
  failures: number;
  startedAt: string;
  endedAt: string;
}

export interface StressResult {
  cameraId: string; cameraName: string; sampleCount: number;
  observedFps: number; growthBytes: number | null;
  staleSamples: number; missingSamples: number; restarted: boolean;
  status: "pass" | "warning" | "failed";
}

export interface EquipmentTestResult {
  cameraId: string;
  microphoneName: string;
  checkedAt: string;
  video: { status: string; frameAgeMs: number | null; message: string };
  audio: { status: string; meanDb: number | null; maxDb: number | null; message: string };
}

export interface TournamentReadiness {
  checkedAt: string;
  preflight: PreflightResult;
  storage: StorageHealth | null;
  storageError: string | null;
  rings: Array<{ ring: string; camera: string; cameraConnected: boolean; microphoneConnected: boolean;
    recording: boolean; recordingHealthy: boolean | null; youtubeLive: boolean; issues: string[] }>;
  blockers: string[];
  warnings: string[];
}

export interface StorageHealth {
  status: "healthy" | "warning" | "critical" | "unknown";
  freeBytes: number;
  totalBytes: number;
  checkedAt: string;
  recordingDirectory: string;
  thresholdsGiB: { warning: number; critical: number };
}

export interface CaptureHealth {
  cameraId: string;
  cameraName: string;
  status: "starting" | "healthy" | "warning";
  warnings: string[];
  recordingFileSize: number | null;
  frameAgeMs: number | null;
  fileGrowthAgeMs: number;
}

export interface RecordingSummary {
  generatedAt: string;
  scannedSessions: number;
  truncated: boolean;
  ringLabelsAreCurrent: boolean;
  events: Array<{eventId: string; eventName: string}>;
  selectedEventId: string | null;
  unattributedSessions: number;
  cameras: Array<{ cameraId: string; cameraName: string; ring: string | null;
    sessions: number; active: number; failures: number; warnings: number;
    segments: number; bytes: number; knownDurationSeconds: number; unknownDurationSessions: number }>;
  totals: { sessions: number; active: number; failures: number; warnings: number;
    segments: number; bytes: number; knownDurationSeconds: number; unknownDurationSessions: number };
}

export interface RecordingEvent {
  timestamp: string;
  type: "recording_started" | "recording_stopped" | "recording_failed";
  cameraId: string;
  detail?: string;
}

export interface YouTubeStream {
  cameraId: string;
  status: "connecting" | "live" | "error";
  startedAt: string;
  progressAgeMs: number | null;
  error: string | null;
}

export type SizeHistory = Record<string, { size: number; lastGrowthAt: number; startedAt: string }>;

export function duration(start: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "Unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(2)} ${units[index]}`;
}

export const request = operatorApi.request;

export function savedLabels(nodeId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`tournament-camera-labels-${nodeId}`) ?? "{}"); }
  catch { return {}; }
}

export function savedMicrophones(nodeId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`tournament-camera-microphones-${nodeId}`) ?? "{}"); }
  catch { return {}; }
}

export interface SessionAssignment {
  cameraId: string;
  cameraName: string;
  microphoneName: string;
  microphoneId?: string;
  ring: string;
}

export interface TournamentSession {
  eventId?: string;
  eventName: string;
  assignments: SessionAssignment[];
}

export interface NodeInfo {
  id: string;
  name: string;
  online: boolean;
  local: boolean;
}

export interface IncidentEntry {
  id: string;
  timestamp: string;
  operator: string;
  ring: string;
  category: string;
  description: string;
  resolution: string;
  resolvedAt?: string;
  sourceAlertKey?: string;
  autoCreated?: boolean;
  impact?: "none" | "degraded" | "interrupted";
  recoveryAction?: string;
}
