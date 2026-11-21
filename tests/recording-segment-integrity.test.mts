import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectRecordingSegments } from '../apps/node-service/src/recording-history.ts';

test('reports gaps and nonregular files without following symbolic links', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'tsm-segments-'));
  try {
    const first = path.join(dir,'cam_0000.mkv');
    await writeFile(first,Buffer.from([1]));
    await writeFile(path.join(dir,'cam_0002.mkv'),Buffer.from([2]));
    const result = await inspectRecordingSegments(first,false);
    assert.equal(result.status,'warning');
    assert.ok(result.issues.some(issue=>issue.includes('index 2')));
    assert.ok(result.issues.some(issue=>issue.includes('Missing segment index 1')));
    assert.equal(result.segments.length,2);
    if (process.platform !== 'win32') {
      await symlink(first,path.join(dir,'cam_0003.mkv'));
      const linked = await inspectRecordingSegments(first,false);
      assert.ok(linked.issues.some(issue=>issue.includes('Not a regular recording file')));
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
