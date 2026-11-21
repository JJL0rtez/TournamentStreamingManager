#!/usr/bin/env node
/** Standalone observer for a publicly reachable media playback endpoint. Run on a different PC/server. */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateObserverConfig, probePlayback, publicPlaybackReport } from '../packages/playback-observer/observer.mjs';
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const configPath = arg('--config');
const outputPath = arg('--output');
const once = process.argv.includes('--once');
const pushEndpoint = process.env.TSM_PLAYBACK_OBSERVER_ENDPOINT;
const pushToken = process.env.TSM_PLAYBACK_OBSERVER_TOKEN;
if (!configPath || !outputPath) { console.error('Usage: node tools/youtube-playback-observer.mjs --config observer.json --output observer-report.json [--once]'); process.exitCode = 2; }
else {
  try {
    const config = validateObserverConfig(JSON.parse(await readFile(configPath, 'utf8')));
    let stop = false;
    process.on('SIGINT', () => { stop = true; });
    process.on('SIGTERM', () => { stop = true; });
    do {
      const started = Date.now();
      // Bounded concurrency of two decoders avoids overwhelming smaller monitoring hosts.
      const results = [];
      for (let i = 0; i < config.cameras.length; i += 2) {
        results.push(...await Promise.all(config.cameras.slice(i, i + 2).map(c => probePlayback(c, config.probeSeconds))));
        if (stop) break;
      }
      const report = publicPlaybackReport(results, new Date().toISOString(), config.observerId);
      const dest = resolve(outputPath);
      await mkdir(dirname(dest), {recursive: true});
      const temp = dest + '.tmp-' + process.pid;
      await writeFile(temp, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
      await rename(temp, dest);
      if (pushEndpoint) {
        try {
          const endpoint = new URL(pushEndpoint);
          if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) ||
            endpoint.pathname !== '/api/operations/playback-observation' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
            !pushToken || pushToken.length < 32) throw new Error('Observer push requires HTTPS (or localhost HTTP), exact API path and a strong token');
          const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json','x-playback-observer-token':pushToken}, body:JSON.stringify(report), signal:AbortSignal.timeout(5000)});
          if (!response.ok) throw new Error(`Observer endpoint returned HTTP ${response.status}`);
        } catch (error) { console.error(`Observer push failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      console.log(`${report.checkedAt}: ${results.filter(r => r.status === 'healthy').length}/${results.length} media endpoints decoded; YouTube platform health not verified`);
      if (once || stop) break;
      const remaining = Math.max(1000, config.intervalSeconds * 1000 - (Date.now() - started));
      await new Promise(resolve => { const timer = setTimeout(resolve, remaining); process.once('SIGINT', () => { stop = true; clearTimeout(timer); resolve(); }); process.once('SIGTERM', () => { stop = true; clearTimeout(timer); resolve(); }); });
    } while (!stop);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
