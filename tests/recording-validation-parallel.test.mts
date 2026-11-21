import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateRecordingSegments } from '../apps/node-service/src/recording-validation.ts';

test('validates a stopped recording using bounded concurrent probes and retains segment order', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tsm-probe-'));
  const old = process.env.FFPROBE_PATH;
  try {
    const probe = path.join(dir, 'fake-ffprobe');
    await writeFile(probe, '#!/bin/sh\nsleep 0.1\nprintf \'{"streams":[{"codec_type":"video","codec_name":"h264"}],"format":{"duration":"12.5"}}\'\n');
    await chmod(probe, 0o755);
    process.env.FFPROBE_PATH = probe;
    for (let i = 0; i < 8; i++) await writeFile(path.join(dir, `cam_${String(i).padStart(4,'0')}.mkv`), 'video');
    const result = await validateRecordingSegments(path.join(dir, 'cam_0000.mkv'), 8);
    assert.equal(result.status, 'ok');
    assert.equal(result.checked, 8);
    assert.deepEqual(result.segments.map(s => s.name), Array.from({length: 8}, (_,i) => `cam_${String(i).padStart(4,'0')}.mkv`));
    assert.ok(result.segments.every(s => s.durationSeconds === 12.5));
  } finally {
    if (old === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = old;
    await rm(dir, {recursive:true,force:true});
  }
});

test('missing recording directory yields a warning rather than a server error', async () => {
  const dir = path.join(os.tmpdir(), 'tsm-missing-' + process.pid + '-' + Date.now());
  const result = await validateRecordingSegments(path.join(dir, 'cam_0000.mkv'));
  assert.equal(result.status, 'warning');
  assert.ok(result.issues.some(s => s.includes('directory')));
});
