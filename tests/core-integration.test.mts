/** Core contract regression tests. No cameras, YouTube credentials, or network access required. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'tournament-core-test-'));
process.env.TOURNAMENT_CONFIG_DIR = path.join(root, 'config');
// Dynamic imports must happen after setting the isolated configuration directory.
const { streamPort } = await import('../apps/node-service/src/stream-port.ts');
const { CameraCapture } = await import('../apps/node-service/src/camera-capture.ts');
const { CameraCaptureManager } = await import('../apps/node-service/src/camera-capture-manager.js');
const { YouTubeStreamManager } = await import('../apps/node-service/src/YouTubeStreamManager.js');
const { inspectRecordingSegments } = await import('../apps/node-service/src/recording-history.js');
const { getCameraQuality, saveCameraQuality } = await import('../apps/node-service/src/camera-quality-settings.js');
const { setSession, getSession } = await import('../apps/node-service/src/tournament-session.js');

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test('275: UDP port is stable for a camera ID', () => {
  assert.equal(streamPort('camera-A'), streamPort('camera-A'));
  assert.ok(streamPort('camera-A') >= 20000 && streamPort('camera-A') < 50000);
});

test('276: two camera IDs map to independently derived transport ports', () => {
  assert.notEqual(streamPort('camera-A'), streamPort('camera-B'));
});

test('277: capture reports waiting for video and audio before start', () => {
  const signal = new CameraCapture().getSignalDiagnostics();
  assert.equal(signal.video.status, 'waiting');
  assert.equal(signal.audio.status, 'waiting-for-audio-samples');
});

test('278: capture manager starts empty and stopping absent camera is safe', async () => {
  const manager = new CameraCaptureManager();
  assert.deepEqual(manager.list(), []);
  assert.equal(manager.get('missing'), null);
  await manager.stop('missing');
  await manager.stopAll();
});

test('279: YouTube relay rejects invalid keys without starting FFmpeg', () => {
  const manager = new YouTubeStreamManager();
  assert.throws(() => manager.start('camera-A', 'short'), /Invalid stream key/);
  assert.deepEqual(manager.list(), []);
});

test('280: YouTube relay stop and stopAll are idempotent when idle', async () => {
  const manager = new YouTubeStreamManager();
  assert.equal(await manager.stop('camera-A'), false);
  await manager.stopAll();
  assert.deepEqual(manager.list(), []);
});

test('281: recording segment inspection identifies contiguous nonempty segments', async () => {
  const dir = path.join(root, 'segments-ok'); await mkdir(dir);
  await writeFile(path.join(dir, 'ring_0000.mkv'), Buffer.from([1, 2]));
  await writeFile(path.join(dir, 'ring_0001.mkv'), Buffer.from([3, 4]));
  const result = await inspectRecordingSegments(path.join(dir, 'ring_0000.mkv'), false);
  assert.equal(result.status, 'ok');
  assert.equal(result.segments.length, 2);
});

test('282: recording inspection flags missing and empty segments', async () => {
  const dir = path.join(root, 'segments-bad'); await mkdir(dir);
  await writeFile(path.join(dir, 'ring_0000.mkv'), Buffer.from([1]));
  await writeFile(path.join(dir, 'ring_0002.mkv'), '');
  const result = await inspectRecordingSegments(path.join(dir, 'ring_0000.mkv'), false);
  assert.equal(result.status, 'warning');
  assert.ok(result.issues.some(issue => issue.includes('Missing segment')));
  assert.ok(result.issues.some(issue => issue.includes('Empty segment')));
});

test('283: camera quality validation rejects unsupported values without persisting', async () => {
  assert.throws(() => saveCameraQuality('camera-A', { width: 1920, height: 1080, fps: 0, recordingBitrateMbps: 12, streamingBitrateKbps: 4500 }), /Invalid fps/);
  assert.ok(getCameraQuality('camera-A').fps > 0);
});

test('284: tournament rejects duplicate camera assignments', () => {
  const assignment = { cameraId: 'camera-A', cameraName: 'Camera A', microphoneName: 'Mic A', ring: 'Ring 1' };
  assert.throws(() => setSession({ eventName: 'Test', assignments: [assignment, { ...assignment, ring: 'Ring 2', microphoneName: 'Mic B' }] }), /unique/);
  assert.equal(getSession(), null);
});

