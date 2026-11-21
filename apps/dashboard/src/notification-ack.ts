export const acknowledgementKey = "tournament-global-notification-ack-v2";
export const acknowledgementEvent = "tournament:notification-acknowledged";
export type Acknowledgement = { nodeId: string; key: string; severity: "critical" | "warning"; at: string };
export function readNotificationMarks(): Record<string, string> {
  try { const marks = JSON.parse(localStorage.getItem(acknowledgementKey) || "{}");
    return marks && typeof marks === "object" && !Array.isArray(marks) ? marks : {}; }
  catch { return {}; }
}
export function publishAcknowledgement(nodeId: string, key: string, severity: Acknowledgement["severity"]): Acknowledgement {
  const mark = { nodeId, key, severity, at: new Date().toISOString() };
  try { localStorage.setItem(acknowledgementKey, JSON.stringify({...readNotificationMarks(), [`${nodeId}:${key}`]:severity})); }
  catch { /* current browser event remains available */ }
  window.dispatchEvent(new CustomEvent<Acknowledgement>(acknowledgementEvent, { detail: mark }));
  return mark;
}
