/** Pure read-model for the operator dashboard; never grants entitlements. */
export type OutputMode = "production" | "diagnostic";
export interface CaptureInventoryInput {
  cameraId: string;
  outputMode: OutputMode;
  running: boolean;
  recordingEnabled: boolean;
  youtubeRelayActive: boolean;
}
export interface OutputInventory {
  production: string[];
  diagnostic: string[];
  cleanRecording: string[];
  cleanStreaming: string[];
  diagnosticRecording: string[];
  diagnosticStreaming: string[];
}
export function summarizeOutputInventory(items: readonly CaptureInventoryInput[]): OutputInventory {
  const unique = new Map<string, CaptureInventoryInput>();
  for (const item of items) {
    if (!item.cameraId.trim()) throw new Error("Camera ID is required");
    if (unique.has(item.cameraId)) throw new Error(`Duplicate camera: ${item.cameraId}`);
    unique.set(item.cameraId, item);
  }
  const all = [...unique.values()].filter(x => x.running);
  const ids = (filter: (item: CaptureInventoryInput) => boolean) => all.filter(filter).map(x=>x.cameraId).sort();
  return {
    production: ids(x=>x.outputMode==="production"),
    diagnostic: ids(x=>x.outputMode==="diagnostic"),
    cleanRecording: ids(x=>x.outputMode==="production" && x.recordingEnabled),
    cleanStreaming: ids(x=>x.outputMode==="production" && x.youtubeRelayActive),
    diagnosticRecording: ids(x=>x.outputMode==="diagnostic" && x.recordingEnabled),
    diagnosticStreaming: ids(x=>x.outputMode==="diagnostic" && x.youtubeRelayActive),
  };
}
/** An unexpected diagnostic relay is a hard fault until YouTube ingest verification exists. */
export function assertNoUnverifiedDiagnosticRelays(items: readonly CaptureInventoryInput[]): void {
  const unsafe = summarizeOutputInventory(items).diagnosticStreaming;
  if (unsafe.length) throw new Error(`Unverified diagnostic YouTube relay: ${unsafe.join(", ")}`);
}
