/** Incident acknowledgement is scoped to an active key and current severity. */
export type NotificationIdentity = { id: string; severity: "critical" | "warning" };
export function summarizeNotifications<T extends NotificationIdentity>(alerts: T[], acknowledged: Record<string, string>, hidden: Record<string, string>) {
  const unacknowledged = alerts.filter(item => acknowledged[item.id] !== item.severity);
  const critical = alerts.filter(item => item.severity === "critical");
  // An acknowledged critical incident remains visible in the active list but must not reappear as a banner.
  const top = unacknowledged.find(item => hidden[item.id] !== item.severity);
  return { unacknowledged, critical, top };
}
export function pruneNotificationMarks(previous: Record<string, string>, alerts: NotificationIdentity[], knownNodes: string[]): Record<string, string> {
  const active = new Map(alerts.map(item => [item.id, item.severity]));
  const next = Object.fromEntries(Object.entries(previous).filter(([id, severity]) =>
    !knownNodes.some(node => id.startsWith(`${node}:`)) || active.get(id) === severity));
  return Object.keys(next).length === Object.keys(previous).length ? previous : next;
}
