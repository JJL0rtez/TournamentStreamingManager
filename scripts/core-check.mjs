import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  ['265', 'root workspaces', 'package.json', /"workspaces"\s*:/],
  ['266', 'Node service typecheck', 'apps/node-service/package.json', /"typecheck"\s*:/],
  ['267', 'dashboard build', 'apps/dashboard/package.json', /"build"\s*:/],
  ['268', 'camera discovery', 'apps/node-service/src/device-discovery.ts', /discoverDevices/],
  ['269', 'capture manager', 'apps/node-service/src/camera-capture-manager.ts', /CameraCaptureManager/],
  ['270', 'recording manager', 'apps/node-service/src/recording-manager.ts', /RecordingManager/],
  ['271', 'YouTube manager', 'apps/node-service/src/YouTubeStreamManager.ts', /YouTubeStreamManager/],
  ['272', 'session management', 'apps/node-service/src/tournament-session.ts', /getSession/],
  ['273', 'remote nodes', 'apps/node-service/src/remote-nodes.ts', /installRemoteNodeRoutes/],
  ['274', 'HTTP health route', 'apps/node-service/src/api.ts', /app\.get\("\/api\/health"/],
];
let failures = 0;
for (const [id, label, relative, pattern] of checks) {
  const path = join(root, relative);
  const pass = existsSync(path) && pattern.test(readFileSync(path, 'utf8'));
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${label}`);
  if (!pass) failures++;
}
console.log(`\nStatic source gates: ${checks.length - failures}/${checks.length}. These checks establish source presence only, not functional correctness.`);
if (failures) process.exitCode = 1;
