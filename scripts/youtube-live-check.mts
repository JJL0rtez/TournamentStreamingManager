import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, classifyRelay, type RelaySnapshot } from "./youtube-live-check-lib.mts";

const options = parseArgs(process.argv.slice(2), process.env);
const base = options.base.replace(/\/$/, "");
const camera = encodeURIComponent(options.cameraId);
const endpoint = `/api/youtube/${camera}`;
let startedByThisTest = false;
let failures = 0;
let lastSnapshot: RelaySnapshot | null = null;

async function request(path: string, method = "GET") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}${path}`, { method, headers: { "Accept": "application/json" }, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof body.error === "string" ? body.error : "Request failed"}`);
    return body;
  } finally { clearTimeout(timeout); }
}
const log = (step: number, ok: boolean, description: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} [${step}] ${description}`);
  if (!ok) failures++;
};

try {
  const preflight = await request(`${endpoint}/preflight`);
  log(335, Boolean(preflight.cameraId === options.cameraId), "Local API reachable and camera ID matches");
  log(336, Array.isArray(preflight.checks), "Preflight returned structured checks");
  log(337, preflight.checks?.some((c: {id:string;ok:boolean}) => c.id === "capture-running" && c.ok) === true, "Camera capture is running");
  log(338, preflight.checks?.some((c: {id:string;ok:boolean}) => c.id === "stream-key" && c.ok) === true, "Saved YouTube stream key configured (key not displayed)");
  log(339, preflight.youtubeVerified === false, "Local preflight does not claim YouTube verification");
  if (!options.goLive) {
    console.log("READ-ONLY: No stream started. Add --go-live --confirm-live-test to perform a real relay test.");
    process.exitCode = failures ? 1 : 0;
  } else {
    if (!preflight.ready) throw new Error(`Preflight failed: ${preflight.checks?.filter((c: {ok:boolean}) => !c.ok).map((c: {message:string}) => c.message).join("; ") || "unknown"}`);
    const start = await request(`${endpoint}/start`, "POST");
    startedByThisTest = Boolean(start.success);
    log(340, startedByThisTest, "Relay start accepted by production API");
    let observedProgress = false;
    let observedActive = false;
    let observedError = false;
    for (let i = 0; i < options.durationSeconds; i += 2) {
      await sleep(2000);
      const health = await request(`${endpoint}/relay-health`) as RelaySnapshot;
      lastSnapshot = health;
      const state = classifyRelay(health);
      observedActive ||= state.active;
      observedProgress ||= state.progressing;
      observedError ||= state.error;
      if (state.error || !state.active) break;
    }
    log(341, observedActive, "Relay process observed active");
    log(342, observedProgress, "FFmpeg reported outgoing relay progress");
    log(343, !observedError && Boolean(lastSnapshot?.active), "No relay failure detected during observation");
    const stop = await request(`${endpoint}/stop`, "POST");
    startedByThisTest = false;
    const after = await request(`${endpoint}/relay-health`);
    log(344, stop.success === true && after.active === false, "Relay stopped without stopping local capture");
    console.log("IMPORTANT: FFmpeg progress is NOT YouTube playback confirmation. Verify YouTube Studio health, video, and audio manually.");
    process.exitCode = failures ? 1 : 0;
  }
} catch (error) {
  console.error(`LIVE TEST ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (startedByThisTest) {
    try { await request(`${endpoint}/stop`, "POST"); console.log("Cleanup: relay stopped."); }
    catch { console.error("Cleanup failed: STOP RELAY MANUALLY IN DASHBOARD."); }
  }
}
