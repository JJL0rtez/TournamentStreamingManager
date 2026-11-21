import assert from "node:assert/strict";
import { test } from "node:test";
import { makeLiveOperationsSnapshot } from "../apps/node-service/src/live-operations-snapshot.ts";
const base = () => ({
  eventId: "event-1", eventName: "Autumn Tournament", now: "2026-11-21T12:00:00.000Z",
  assignments: [{ cameraId: "r1", ring: "Ring 1", cameraName: "Front" }, { cameraId: "r2", ring: "Ring 2" }],
  captures: [{ cameraId: "r1", running: true, recordingEnabled: true, outputMode: "production", frameAgeMs: 100,
    recordingPath: "C:/private/recordings/r1.mkv" }],
  relays: [{ cameraId: "r1", relayHealth: "sending", lastProgressAt: 100 }],
  captureRetries: [], relayRetries: []
});
test("missing assigned camera is critical without affecting healthy neighbour", () => {
  const result = makeLiveOperationsSnapshot(base());
  assert.equal(result.counts.critical, 1);
  assert.equal(result.rows[0].severity, "ok");
  assert.equal(result.rows[1].severity, "critical");
  assert.equal(result.youtubeVerified, false);
  assert.ok(!JSON.stringify(result).includes("C:/private"));
});
test("stalled relay and frozen capture are critical and distinguish recording", () => {
  const input = base();
  input.captures[0].frameAgeMs = 7000;
  input.relays[0].relayHealth = "stalled";
  const row = makeLiveOperationsSnapshot(input).rows[0];
  assert.equal(row.severity, "critical");
  assert.equal(row.recording, "enabled");
  assert.equal(row.issues.length, 2);
});
test("pending retry is surfaced and optional inactive relay not treated as failed", () => {
  const input = base();
  input.relays = [];
  input.captureRetries = [{ cameraId: "r1", pending: true, attempts: 2, nextRetryAt: "2026-11-21T12:00:04Z" }];
  const row = makeLiveOperationsSnapshot(input).rows[0];
  assert.equal(row.relay, "inactive");
  assert.equal(row.severity, "warning");
  assert.equal(row.recoveryAttempts, 2);
});
test("unassigned captures and relays are reported, no session is not healthy by default", () => {
  const input = base();
  input.assignments = [];
  const result = makeLiveOperationsSnapshot(input);
  assert.equal(result.configured, false);
  assert.deepEqual(result.unassignedActiveCaptures, ["r1"]);
  assert.deepEqual(result.unassignedActiveRelays, ["r1"]);
});
