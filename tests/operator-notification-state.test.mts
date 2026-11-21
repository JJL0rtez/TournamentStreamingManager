import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeNotifications, pruneNotificationMarks } from '../apps/dashboard/src/notification-state.ts';
const critical = { id: 'pc1:storage', severity: 'critical' as const, message: '9 GiB remaining' };
const warning = { id: 'pc1:relay', severity: 'warning' as const, message: 'Stalled' };
test('acknowledging an active critical alert removes its banner but retains the active incident', () => {
  const alerts = [critical, warning];
  const next = summarizeNotifications(alerts, { [critical.id]: 'critical' }, {});
  assert.equal(next.top?.id, warning.id); assert.equal(next.critical.length, 1);
  assert.equal(next.unacknowledged.length, 1); assert.equal(alerts.length, 2);
  assert.equal(summarizeNotifications(alerts, { [critical.id]: 'critical', [warning.id]: 'warning' }, {}).top, undefined);
});
test('changing metrics do not undo acknowledgement; escalating severity does', () => {
  const ack = { [critical.id]: 'critical' };
  assert.equal(summarizeNotifications([{...critical, message:'8 GiB remaining'}], ack, {}).top, undefined);
  assert.equal(summarizeNotifications([critical], {[critical.id]:'warning'}, {}).top?.id, critical.id);
});
test('resolved incidents and escalations clear old acknowledgement; unknown nodes are preserved', () => {
  const marks = {'pc1:storage':'critical','pc2:relay':'warning'};
  const pruned = pruneNotificationMarks(marks, [], ['pc1']);
  assert.deepEqual(pruned, {'pc2:relay':'warning'});
  assert.equal(summarizeNotifications([critical], pruned, {}).top?.id, critical.id);
  assert.deepEqual(pruneNotificationMarks({'pc1:storage':'warning'}, [critical], ['pc1']), {});
});
test('hide does not acknowledge, and does not suppress escalated incidents', () => {
  const result = summarizeNotifications([warning], {}, {[warning.id]:'warning'});
  assert.equal(result.top, undefined); assert.equal(result.unacknowledged.length, 1);
  assert.equal(summarizeNotifications([{...warning,severity:'critical'}],{}, {[warning.id]:'warning'}).top?.id, warning.id);
});
