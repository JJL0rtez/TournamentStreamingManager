import { readDiagnosticThresholds } from "./diagnostic-thresholds.js";
import { analyzeUsbRecordingCorrelation } from "./usb-recording-correlation.js";
import { analyzeResourceFailureCorrelation } from "./resource-failure-correlation.js";

/** One report per failed session. Timestamp proximity is evidence, not causation. */
export async function investigateRecordingFailures(windowSeconds = 120) {
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0 || windowSeconds > 600)
    throw new Error("windowSeconds must be between 0 and 600");
  const [usb, resources] = await Promise.all([
    analyzeUsbRecordingCorrelation(windowSeconds),
    analyzeResourceFailureCorrelation(windowSeconds)
  ]);
  const thresholds = await readDiagnosticThresholds();
  const failures = usb.sessions.filter(session => session.outcome === "failed");
  const bySession = new Map(resources.sessions.map(row => [
    `${row.cameraId}\u0000${row.recordingPath}`, row
  ]));
  const rows = failures.map(session => {
    const matching = bySession.get(`${session.cameraId}\u0000${session.recordingPath}`);
    const peak = matching?.maximumNearby;
    const flags: string[] = [];
    if (session.intervalKnown && session.matchingDisconnects >= thresholds.minimumUsbDisconnects)
      flags.push(`Observed ${session.matchingDisconnects} nearby USB disconnection(s)`);
    if (peak?.cpuPercent != null && peak.cpuPercent >= thresholds.cpuPercent)
      flags.push(`CPU reached ${peak.cpuPercent}%`);
    if (peak?.gpuPercent != null && peak.gpuPercent >= thresholds.gpuPercent)
      flags.push(`GPU reached ${peak.gpuPercent}%`);
    if (peak?.ramUsedPercent != null && peak.ramUsedPercent >= thresholds.ramPercent)
      flags.push(`RAM reached ${peak.ramUsedPercent}%`);
    if (peak?.diskWriteMiBps != null && peak.diskWriteMiBps >= thresholds.diskWriteMiBps)
      flags.push(`Host disk writes reached ${peak.diskWriteMiBps} MiB/s`);
    return {
      diagnosticWarnings: flags,
      cameraId: session.cameraId,
      cameraName: session.cameraName,
      recordingPath: session.recordingPath,
      failedAt: session.endedAt,
      observedUsbDisconnects: session.matchingDisconnects,
      disconnectTimes: session.disconnectTimes,
      usbIntervalKnown: session.intervalKnown,
      resourceSamples: matching?.nearbySamples ?? 0,
      closestResourceReading: matching?.closest ?? null,
      peakNearbyResources: matching?.maximumNearby ?? null,
      resourceWithinRetention: matching?.inRetention ?? false,
      evidence: {
        usb: !session.intervalKnown ? "unknown" : session.correlated ? "nearby-disconnection" : "none-observed",
        resources: !matching || !matching.nearbySamples ? "no-samples" : "samples-available"
      }
    };
  });
  // Prioritized troubleshooting suggestions based on observed evidence, not inferred root causes.
  // A single failed session may appear in several categories. No-data is never treated as healthy.
  const usbCases = rows.filter(row => row.usbIntervalKnown &&
    row.observedUsbDisconnects >= thresholds.minimumUsbDisconnects);
  const cpuCases = rows.filter(row => row.peakNearbyResources?.cpuPercent != null &&
    row.peakNearbyResources.cpuPercent >= thresholds.cpuPercent);
  const gpuCases = rows.filter(row => row.peakNearbyResources?.gpuPercent != null &&
    row.peakNearbyResources.gpuPercent >= thresholds.gpuPercent);
  const ramCases = rows.filter(row => row.peakNearbyResources?.ramUsedPercent != null &&
    row.peakNearbyResources.ramUsedPercent >= thresholds.ramPercent);
  const diskCases = rows.filter(row => row.peakNearbyResources?.diskWriteMiBps != null &&
    row.peakNearbyResources.diskWriteMiBps >= thresholds.diskWriteMiBps);
  const unknownCases = rows.filter(row => !row.usbIntervalKnown || !row.resourceSamples);
  const cameras = (cases: typeof rows) => [...new Set(cases.map(row => row.cameraName || row.cameraId))];
  const recommendations = [
    { id: "usb", priority: "high", title: "Investigate USB connection stability",
      affectedSessions: usbCases.length, cameras: cameras(usbCases),
      evidence: `Observed nearby disconnections for ${usbCases.length} failed session(s).`,
      nextSteps: ["Inspect cable seating and port power; avoid passive hubs.",
        "Verify USB host-controller topology in Windows Device Manager.",
        "Move one affected camera to a separately verified controller, then repeat the stress test."] },
    { id: "cpu", priority: "high", title: "Check CPU contention",
      affectedSessions: cpuCases.length, cameras: cameras(cpuCases),
      evidence: `CPU exceeded the configured threshold near ${cpuCases.length} failed session(s).`,
      nextSteps: ["Check background tasks and concurrent encoding processes.",
        "Compare CPU usage with fewer cameras while keeping the same recording settings."] },
    { id: "gpu", priority: "high", title: "Check GPU or encoder workload",
      affectedSessions: gpuCases.length, cameras: cameras(gpuCases),
      evidence: `GPU utilization exceeded the threshold near ${gpuCases.length} failed session(s).`,
      nextSteps: ["Inspect NVIDIA encoder usage separately; overall GPU usage is not NVENC utilization.",
        "Repeat with fewer concurrent streams to check whether failures recur."] },
    { id: "disk", priority: "medium", title: "Inspect recording storage performance",
      affectedSessions: diskCases.length, cameras: cameras(diskCases),
      evidence: `Host-wide write throughput exceeded the threshold near ${diskCases.length} failed session(s).`,
      nextSteps: ["Confirm destination drive free space and recording write latency.",
        "Compare destination-drive activity, not just host-wide throughput, during a repeat test."] },
    { id: "ram", priority: "medium", title: "Inspect system memory pressure",
      affectedSessions: ramCases.length, cameras: cameras(ramCases),
      evidence: `RAM utilization exceeded the threshold near ${ramCases.length} failed session(s).`,
      nextSteps: ["Check available memory and paging activity during a repeat stress test."] },
    { id: "coverage", priority: "info", title: "Improve diagnostic sampling coverage",
      affectedSessions: unknownCases.length, cameras: cameras(unknownCases),
      evidence: `USB history or resource samples are missing for ${unknownCases.length} failed session(s).`,
      nextSteps: ["Leave node monitoring running during a new controlled recording test.",
        "Review USB event sampling limitations and retained resource-history window."] }
  ].filter(item => item.affectedSessions > 0);
  return {
    recommendations,
    generatedAt: new Date().toISOString(), windowSeconds: Math.trunc(windowSeconds),
    diagnosticThresholds: thresholds,
    sessionsWithDiagnosticWarnings: rows.filter(row => row.diagnosticWarnings.length > 0).length,
    failedSessions: rows.length,
    withNearbyDisconnect: rows.filter(row => row.observedUsbDisconnects > 0).length,
    withResourceSamples: rows.filter(row => row.resourceSamples > 0).length,
    sessions: rows,
    limitations: [
      "Only failed sessions present in the latest 200 recording journal entries are included.",
      "USB disconnects are sampled approximately every 30 seconds and may miss short interruptions.",
      "Resource measurements are approximately 15 seconds apart, host-wide, and retained for a limited time.",
      "A missing USB or resource match is not evidence of normal operation.",
      "Both comparisons use the same configurable timestamp margin but different event definitions.",
      "Timestamp correlation cannot identify the root cause of a recording failure.",
      "Threshold warnings are screening indicators only. Disk throughput is host-wide, not disk capacity or saturation.",
      "Unavailable measurements never trigger a warning; absence of a warning is not evidence of a healthy system."
    ]
  };
}
