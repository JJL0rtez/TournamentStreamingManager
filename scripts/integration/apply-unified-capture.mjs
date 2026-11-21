import fs from 'node:fs';
import path from 'node:path';
// Batch 22 intentionally disables the legacy installer: it cannot safely rewrite
// a running API with independent YouTube coordinator and capture/recording managers.
// Readiness is installed directly in api.ts, without altering any start/stop paths.
const api = path.resolve('apps/node-service/src/api.ts');
if (!fs.existsSync(api)) throw Error(`API_NOT_FOUND: ${api}`);
const source = fs.readFileSync(api, 'utf8');
if (!source.includes('/api/captures/ownership-readiness')) throw Error('BATCH22_READINESS_ROUTE_MISSING');
console.log('Unified capture readiness endpoint present. No FFmpeg or coordinator lifecycle modified.');
console.log('Unified ownership activation remains disabled until start/stop routes are reconciled.');
