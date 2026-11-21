/** Shared event format for later notification/report consolidation. */
export type DiagnosticCategory = "camera" | "audio" | "recording" | "youtube" | "usb" | "system" | "recovery";
export type DiagnosticSeverity = "info" | "warning" | "critical";
export interface DiagnosticEvent { id:string; timestamp:string; nodeId:string; cameraId?:string; category:DiagnosticCategory; severity:DiagnosticSeverity; code:string; message:string; correlationId?:string }
export function deduplicateEvents(events: readonly DiagnosticEvent[]): DiagnosticEvent[] {
 const latest = new Map<string, DiagnosticEvent>();
 for(const event of events) {
  const key = `${event.nodeId}|${event.cameraId??""}|${event.category}|${event.code}|${event.correlationId??""}`;
  const previous = latest.get(key);
  if (!previous || event.timestamp > previous.timestamp) latest.set(key,event);
 }
 return [...latest.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
}
