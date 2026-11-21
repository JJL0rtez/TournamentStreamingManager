#!/usr/bin/env node
/** Runs the independent read-only playback observer with bounded restart attempts.
 * Deliberately never starts, stops or modifies tournament camera/YouTube processes.
 */
import { spawn } from 'node:child_process';
import { nextObserverRestart } from '../packages/playback-observer/supervision.mjs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const value = key => { const at = process.argv.indexOf(key); return at === -1 ? null : process.argv[at+1]; };
const config = value('--config');
const output = value('--output');
if (!config || !output || config.startsWith('--') || output.startsWith('--')) {
  console.error('Usage: node tools/playback-observer-supervisor.mjs --config observer.json --output observer-report.json');
  process.exitCode = 2;
} else {
  try {
    await access(resolve(config));
    let stopping = false;
    let child = null;
    let sleepDone = null;
    const stop = signal => {
      stopping = true;
      if (child && child.exitCode === null) child.kill(signal);
      sleepDone?.();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
    let attempts = [];
    while (!stopping) {
      const startedAt = Date.now();
      const exit = await new Promise(resolveExit => {
        const proc = spawn(process.execPath, [fileURLToPath(new URL('./youtube-playback-observer.mjs', import.meta.url)), '--config', resolve(config), '--output', resolve(output)], {
          stdio:'inherit', windowsHide:true, env:process.env
        });
        child = proc;
        let finished = false;
        const done = (code, signal) => {
          if (finished) return;
          finished = true;
          child = null;
          resolveExit({code,signal});
        };
        proc.once('error', () => done(1,null));
        proc.once('exit', (code,signal) => done(code,signal));
      });
      if (stopping) break;
      const result = nextObserverRestart(attempts,Date.now(),Date.now()-startedAt);
      if (!result.allowed) {
        console.error('Playback observer restart budget exhausted; manual operator review required');
        process.exitCode = 1;
        break;
      }
      attempts = result.attempts;
      console.error(`Playback observer exited (code ${exit.code ?? 'signal'}); restarting in ${result.delayMs} ms (attempt ${attempts.length}/5)`);
      await new Promise(resolveSleep => {
        let finished = false;
        const done = () => { if (finished) return; finished = true; clearTimeout(timer); sleepDone = null; resolveSleep(); };
        const timer = setTimeout(done,result.delayMs);
        sleepDone = done;
        if (stopping) done();
      });
    }
  } catch (error) {
    console.error(`Observer supervisor setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
