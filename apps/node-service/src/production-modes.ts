/** Explicit modes for future output authorization. Not yet wired into FFmpeg routes. */
export type OutputMode = "production" | "diagnostic";
export type InputSource = { kind: "camera"; deviceId: string } | { kind: "file"; filePath: string } | { kind: "synthetic"; pattern: string };
export type TransportKind = "direct-ethernet" | "lan" | "tailscale";
export interface OutputRequest { mode: OutputMode; cameraId: string; stream: boolean; record: boolean }
export interface ProductionEntitlement { kind: "free" | "event"; cleanRingLimit: number | null; validUntil?: string }
/** This pure policy helper is not an authorization boundary until all start routes call it. */
export function checkOutputEntitlement(entitlement: ProductionEntitlement, requests: readonly OutputRequest[]) {
  const clean = requests.filter(r => r.mode === "production" && (r.stream || r.record));
  const rings = new Set(clean.map(r => r.cameraId));
  const allowed = entitlement.cleanRingLimit === null || rings.size <= entitlement.cleanRingLimit;
  return { allowed, cleanRings: rings.size, diagnosticJobs: requests.filter(r=>r.mode === "diagnostic").length,
    reason: allowed ? null : "Clean production exceeds the licensed ring entitlement" };
}
