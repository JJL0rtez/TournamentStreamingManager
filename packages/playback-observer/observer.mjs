/** Independent playback observer. No streaming credentials are needed or persisted. */
import { spawn } from 'node:child_process';

const cameraPattern = /^[a-zA-Z0-9_-]{1,64}$/;
export function validateObserverConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cameras) || raw.cameras.length < 1 || raw.cameras.length > 8) throw new Error('Specify 1 to 8 playback cameras');
  const observerId = raw.observerId ?? 'default';
  if (typeof observerId !== 'string' || !cameraPattern.test(observerId)) throw new Error('Invalid observerId');
  const cameras = raw.cameras.map(entry => {
    if (!entry || !cameraPattern.test(entry.cameraId)) throw new Error('Invalid cameraId');
    if (typeof entry.playbackUrl !== 'string' || entry.playbackUrl.length > 2048) throw new Error('Invalid playback URL');
    let url;
    try { url = new URL(entry.playbackUrl); } catch { throw new Error('Invalid playback URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?)/i.test(url.hostname)) throw new Error('Playback URL must be public HTTPS without credentials');
    if (url.search) throw new Error('Playback URL query parameters are prohibited to avoid disclosing signed tokens');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error('Playback URL must use a DNS hostname');
    return { cameraId: entry.cameraId, playbackUrl: url.toString() };
  });
  if (new Set(cameras.map(c => c.cameraId)).size !== cameras.length) throw new Error('Duplicate cameraId');
  const intervalSeconds = raw.intervalSeconds ?? 30;
  const probeSeconds = raw.probeSeconds ?? 12;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 15 || intervalSeconds > 3600) throw new Error('intervalSeconds must be 15..3600');
  if (!Number.isInteger(probeSeconds) || probeSeconds < 5 || probeSeconds > 60 || probeSeconds > intervalSeconds) throw new Error('probeSeconds must be 5..60 and <= intervalSeconds');
  return { observerId, cameras, intervalSeconds, probeSeconds };
}

export function classifyPlaybackProbe({ code, timedOut = false, stderr = '', elapsedMs = 0 }, cameraId, checkedAt = new Date().toISOString()) {
  const freezeEvents = (stderr.match(/freeze_start:/g) || []).length;
  const blackEvents = (stderr.match(/black_start:/g) || []).length;
  const silenceEvents = (stderr.match(/silence_start:/g) || []).length;
  const frames = [...stderr.matchAll(/frame=\s*(\d+)/g)].map(m => Number(m[1]));
  const framesDecoded = frames.length ? Math.max(...frames) : 0;
  const issues = [];
  if (timedOut) issues.push('Playback decoder timed out');
  if (code !== 0 && !timedOut) issues.push('Playback decoder failed');
  if (!framesDecoded) issues.push('No decoded video frames');
  if (freezeEvents) issues.push(`${freezeEvents} frozen-video interval(s)`);
  if (blackEvents) issues.push(`${blackEvents} black-video interval(s)`);
  if (silenceEvents) issues.push(`${silenceEvents} silence interval(s); confirm audio is expected`);
  return { cameraId, checkedAt, status: issues.length ? 'warning' : 'healthy', framesDecoded, freezeEvents, blackEvents, silenceEvents, elapsedMs, issues,
    // A successful decode only confirms this worker accessed the specified media URL.
    playbackTransportChecked: true, youtubePlatformVerified: false };
}

export async function probePlayback(camera, probeSeconds, options = {}) {
  const ffmpeg = options.ffmpeg || 'ffmpeg';
  const timeoutMs = Math.max(8_000, (probeSeconds + 12) * 1000);
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-rw_timeout', '8000000', '-i', camera.playbackUrl,
    '-t', String(probeSeconds), '-vf', 'freezedetect=n=-50dB:d=2,blackdetect=d=1:pix_th=0.10',
    '-af', 'silencedetect=noise=-40dB:d=3', '-f', 'null', '-'];
  const start = Date.now();
  return new Promise(resolve => {
    let child;
    let completed = false;
    let timedOut = false;
    let stderr = '';
    const done = code => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      resolve(classifyPlaybackProbe({ code, timedOut, stderr, elapsedMs: Date.now() - start }, camera.cameraId));
    };
    try { child = (options.spawn || spawn)(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch { resolve(classifyPlaybackProbe({ code: -1, stderr: '' }, camera.cameraId)); return; }
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); done(-1); }, timeoutMs);
    child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-64_000); });
    child.on('error', () => done(-1));
    child.on('close', code => done(code ?? -1));
  });
}

export function publicPlaybackReport(results, now = new Date().toISOString(), observerId = 'default') {
  if (typeof observerId !== 'string' || !cameraPattern.test(observerId)) throw new Error('Invalid observerId');
  return { schemaVersion: 1, observerId, checkedAt: now, source: 'independent-ffmpeg-playback', youtubePlatformVerified: false,
    cameras: results.map(({ cameraId, checkedAt, status, framesDecoded, freezeEvents, blackEvents, silenceEvents, elapsedMs, issues, playbackTransportChecked }) => ({cameraId, checkedAt, status, framesDecoded, freezeEvents, blackEvents, silenceEvents, elapsedMs, issues, playbackTransportChecked})) };
}
