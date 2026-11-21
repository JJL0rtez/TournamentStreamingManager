/** Centralized preflight for all currently identified output-start API routes.
 * Diagnostic video MUST NOT use these unwatermarked production paths.
 * The optional free-ring limit is disabled until an explicit deployment opt-in.
 * This is NOT a commercial licensing or tamper-resistant entitlement system.
 */
export interface StartDecision { allowed: boolean; status: number; code: string; reason: string | null }
export interface StartRequest {
  requestedMode: unknown; cameraIds: readonly unknown[]; activeCameraIds: readonly string[]; enforcementEnabled: boolean; diagnosticCaptureAllowed?: boolean;
}
const deny = (status: number, code: string, reason: string): StartDecision => ({allowed:false,status,code,reason});
export function evaluateOutputStart(input: StartRequest): StartDecision {
  if (input.requestedMode !== undefined && input.requestedMode !== "production" && input.requestedMode !== "diagnostic")
    return deny(400,"INVALID_OUTPUT_MODE","mode must be production or diagnostic");
  if (input.requestedMode === "diagnostic") {
    if (!input.diagnosticCaptureAllowed) return deny(409,"DIAGNOSTIC_PIPELINE_NOT_READY","Diagnostic output is not enabled on this route.");
    return {allowed:true,status:200,code:"WATERMARKED_LOCAL_DIAGNOSTIC",reason:null};
  }
  if (!input.enforcementEnabled) return {allowed:true,status:200,code:"LEGACY_PRODUCTION",reason:null};
  const requested = input.cameraIds.filter((id):id is string => typeof id === "string" && id.trim().length > 0);
  const all = new Set([...input.activeCameraIds, ...requested]);
  if (all.size > 1) return deny(403,"FREE_RING_LIMIT","Free production permits one clean camera/ring at a time on this node.");
  return {allowed:true,status:200,code:"FREE_PRODUCTION",reason:null};
}
export function summarizeOutputRoutes(input:{enforcementEnabled:boolean;diagnosticWatermarkReady:boolean;activeCameraIds:readonly string[]}) {
 return {
  freeProductionEnforcementEnabled:input.enforcementEnabled,
  diagnosticWatermarkReady:input.diagnosticWatermarkReady,
  commercialLicensingReady:false,
  activeCleanCameraIds:[...new Set(input.activeCameraIds)],
  guardedStartRoutes:["/api/captures/start","/api/recordings/start","/api/session/start-all","/api/youtube/:cameraId/start","/api/youtube/start-all"],
  warning:"Legacy production remains unrestricted unless TSM_ENFORCE_FREE_PRODUCTION=1. Diagnostic video starts are rejected until watermarked output is implemented. This is not a complete commercial authorization boundary.",
 };
}
