/** Windows hardware smoke test. Uses the production CameraCapture pipeline, no YouTube credentials. */
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CameraCapture } from '../apps/node-service/src/camera-capture.ts';
import { captureTransportPort } from '../apps/node-service/src/capture-contract.ts';

const cameraName = process.env.TOURNAMENT_TEST_CAMERA || 'EMEET SmartCam S600';
const microphoneName = process.env.TOURNAMENT_TEST_MIC || process.env.TS_HARDWARE_MICROPHONE || 'Microphone (6- EMEET SmartCam S600)';
const cameraId = process.env.TOURNAMENT_TEST_CAMERA_ID || 'hardware-smoke-1';
const seconds = Math.max(8, Math.min(120, Number(process.env.TOURNAMENT_TEST_SECONDS || '15')));
const outputDirectory = path.resolve(process.env.TOURNAMENT_TEST_OUTPUT || 'recordings/hardware-smoke');
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const checks: Array<{ step: number; description: string; pass: boolean; detail?: string }> = [];
function check(step: number, description: string, pass: boolean, detail?: string) {
  checks.push({ step, description, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${step}] ${description}${detail ? `: ${detail}` : ''}`);
}
async function probe(file: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate','-of','json',file], { windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', data => out += String(data));
    child.stderr.on('data', data => err += String(data));
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error(`ffprobe exited ${code}: ${err.slice(-500)}`));
      else { try { resolve(JSON.parse(out)); } catch (e) { reject(e); } }
    });
  });
}
const capture = new CameraCapture();
const udp = createSocket('udp4');
let udpPackets = 0;
let udpBytes = 0;
let udpSyncPackets = 0;
let stopping = false;
let started = false;
let previewCount = 0;
let frameStats: ReturnType<CameraCapture['getFrameStats']> | undefined;
let segments: Awaited<ReturnType<CameraCapture['getRecordingSegments']>> = [];
let recording: string | null = null;
let exitError: string | undefined;
let probeInfo: any;
const port = captureTransportPort(cameraId);
udp.on('message', packet => {
  udpPackets++; udpBytes += packet.length;
  if (packet.length >= 188 && packet[0] === 0x47) udpSyncPackets++;
});
try {
  await mkdir(outputDirectory, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(port, '127.0.0.1', () => { udp.off('error', reject); resolve(); });
  });
  check(295, 'UDP receiver bound before capture', true, `127.0.0.1:${port}`);
  recording = await capture.start({ cameraId, cameraName, microphoneName, outputDirectory, recordingEnabled: true, inputFps: 30 });
  started = true;
  check(296, 'Production FFmpeg capture started', capture.isRunning);
  try { await capture.waitUntilReady(20000); check(297, 'First preview frame received', true); }
  catch (e) { check(297, 'First preview frame received', false, String(e)); }
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && capture.isRunning) {
    if (capture.getFrame()) previewCount++;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  frameStats = capture.getFrameStats();
  check(298, 'Preview updates while recording', (frameStats.frameCount ?? 0) >= 5, `${frameStats.frameCount} frames`);
  check(299, 'MPEG-TS UDP packets received', udpPackets >= 10 && udpSyncPackets >= 5, `${udpPackets} packets, ${udpBytes} bytes, ${udpSyncPackets} sync packets`);
  check(300, 'Capture stays running for test interval', capture.isRunning);
  stopping = true;
  await capture.stop();
  check(301, 'Graceful FFmpeg shutdown', !capture.isRunning);
  await capture.stop();
  check(302, 'Repeated stop is safe', !capture.isRunning);
  segments = await capture.getRecordingSegments();
  check(303, 'Recording segments exist and are nonempty', segments.length > 0 && segments.every(s => s.bytes > 1024), `${segments.length} segments`);
  if (segments.length) {
    try {
      probeInfo = await probe(segments[0].path);
      const video = (probeInfo.streams || []).find((s: any) => s.codec_type === 'video');
      const audio = (probeInfo.streams || []).find((s: any) => s.codec_type === 'audio');
      check(304, 'Finalized recording contains H.264 video and AAC audio', video?.codec_name === 'h264' && audio?.codec_name === 'aac', `video=${video?.codec_name ?? 'none'} audio=${audio?.codec_name ?? 'none'}`);
    } catch (e) { check(304, 'Finalized recording contains H.264 video and AAC audio', false, String(e)); }
  } else check(304, 'Finalized recording contains H.264 video and AAC audio', false, 'No segment to inspect');
} catch (e) {
  exitError = e instanceof Error ? e.stack || e.message : String(e);
  console.error('Hardware test error:', exitError);
} finally {
  if (!stopping && started) { try { await capture.stop(); } catch (e) { console.error('Cleanup error:', e); } }
  udp.close();
  const report = { timestamp: new Date().toISOString(), cameraName, microphoneName, cameraId, seconds, port, recording, udpPackets, udpBytes, previewCount, frameStats, segments, probeInfo, checks, exitError };
  const reportPath = path.join(outputDirectory, `hardware-smoke-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
  console.log(`RESULT: ${checks.filter(c => c.pass).length}/10 checks passed`);
  if (checks.length !== 10 || checks.some(c => !c.pass) || exitError) process.exitCode = 1;
}
