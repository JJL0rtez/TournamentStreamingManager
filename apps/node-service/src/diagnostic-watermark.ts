/**
 * Burn-in overlay for explicitly diagnostic video outputs.
 * Apply BEFORE encoding, never as a dashboard-only overlay.
 * No licensing route should be enabled until every output branch is covered.
 */
export const DIAGNOSTIC_LABEL = "TEST STREAM / DIAGNOSTIC MODE";

/** Repeat a diagonal watermark in the video itself and draw a conspicuous top band. */
export function diagnosticVideoFilter(): string {
  // drawtext uses FFmpeg expression expansion for a moving x coordinate.
  // White and black markings remain legible over both bright and dark scenes.
  return [
    "drawbox=x=0:y=0:w=iw:h=78:color=black@0.88:t=fill",
    "drawtext=text='TEST STREAM / DIAGNOSTIC MODE':fontsize=30:fontcolor=yellow:borderw=2:bordercolor=black:x=(w-text_w)/2:y=20",
    "drawtext=text='DIAGNOSTIC MODE':fontsize=44:fontcolor=white@0.55:borderw=2:bordercolor=black@0.7:x=mod(t*37\\,w+text_w)-text_w:y=h*0.47",
    "drawtext=text='NOT FOR PRODUCTION':fontsize=26:fontcolor=yellow@0.7:borderw=2:bordercolor=black:x=w*0.12:y=h*0.78"
  ].join(",");
}

export interface DiagnosticEncodingOptions {
  inputArgs: readonly string[];
  outputFile: string;
  durationSeconds: number;
  videoEncoder?: string;
}

/**
 * Create an explicitly watermarked local diagnostic sample.
 * Does not expose a clean output route or enable a production entitlement.
 */
export function diagnosticSampleArgs(options: DiagnosticEncodingOptions): string[] {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 1 || options.durationSeconds > 300)
    throw new Error("Diagnostic sample duration must be 1 to 300 seconds.");
  if (!options.outputFile.toLowerCase().endsWith(".mkv"))
    throw new Error("Diagnostic samples must use .mkv output.");
  if (!options.inputArgs.length) throw new Error("An input source is required.");
  const encoder = options.videoEncoder ?? "libx264";
  if (!["libx264", "h264_nvenc"].includes(encoder)) throw new Error("Unsupported diagnostic encoder.");
  return [
    "-hide_banner", "-nostdin", "-y",
    ...options.inputArgs,
    "-t", String(options.durationSeconds),
    "-map", "0:v:0", "-vf", diagnosticVideoFilter(),
    "-c:v", encoder, "-pix_fmt", "yuv420p",
    "-an", "-f", "matroska", options.outputFile
  ];
}
