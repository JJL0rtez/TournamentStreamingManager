/** Hardware-aware configuration report. Never treats configured count as tested throughput. */
export interface CapacityAssignment { cameraId: string; cameraName?: string; microphoneName?: string; ring: string }
export interface CapacityIssue { code: string; message: string; ring?: string }
export function evaluateAssignmentIssues(assignments: readonly CapacityAssignment[]): CapacityIssue[] {
  const issues: CapacityIssue[] = [];
  for (const [key, code] of [["cameraId", "duplicate-camera"], ["ring", "duplicate-ring"]] as const) {
    const seen = new Set<string>();
    for (const item of assignments) {
      const value = String(item[key] ?? "").trim().toLowerCase();
      if (!value) { issues.push({ code: `missing-${key}`, message: `${key} is required`, ring: item.ring }); continue; }
      if (seen.has(value)) issues.push({ code, message: `Duplicate ${key}: ${item[key]}`, ring: item.ring });
      seen.add(value);
    }
  }
  const microphones = new Map<string, string[]>();
  for (const item of assignments) {
    const mic = (item.microphoneName ?? "").trim().toLowerCase();
    if (mic) microphones.set(mic, [...(microphones.get(mic) ?? []), item.ring]);
  }
  for (const [mic, rings] of microphones) if (rings.length > 1) issues.push({ code: "shared-microphone", message: `Microphone ${mic} assigned to multiple rings: ${rings.join(", ")}` });
  return issues;
}
export function evaluateConfiguredCapacity(assignments: readonly CapacityAssignment[]) {
  return { configuredCameras: new Set(assignments.map(a => a.cameraId)).size,
    configuredRings: new Set(assignments.map(a => a.ring)).size,
    configuredAssignments: assignments.length };
}
export function makeCapacityReport(assignments: readonly CapacityAssignment[]) {
  return { ...evaluateConfiguredCapacity(assignments), status: "unverified" as const,
    verifiedSimultaneousCameras: null, verifiedSimultaneousStreams: null,
    verifiedSimultaneousRecordings: null,
    limitation: "Configured assignments are not a hardware benchmark. Run simultaneous camera, encoder, recording and network tests before production.",
    issues: evaluateAssignmentIssues(assignments) };
}
