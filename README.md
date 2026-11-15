# Tournament Streaming Manager: Milestone 100 integration checkpoint

This archive **reconstructs a runnable workspace layout** from the available cumulative milestone source subsets and earlier project files. It does **not** establish that the application compiles or functions correctly on Windows. Source has been merged, missing local modules restored, package manifests recreated, and a malformed dashboard JSX block repaired.

## Prerequisites
- Windows 10/11, Node.js 22, npm
- FFmpeg on PATH (or FFMPEG_PATH pointing to ffmpeg.exe)
- NVIDIA GPU drivers and `nvidia-smi` where GPU metrics are desired
- Camera and microphone hardware

## Setup (PowerShell)
```powershell
cd C:\Projects\TournamentStreaming
npm install
npm run typecheck
npm run build
```

If these commands succeed, start **two terminals**:
```powershell
npm run dev:node
```
```powershell
npm run dev
```

Open the Vite URL printed by the dashboard (normally http://localhost:5173). The Node service listens on port 3001 unless PORT is set. Dashboard Vite proxies `/api` to port 3001. Check authentication settings before exposing the node service to a network. Do not publish streaming keys or sensitive configuration files.

## Integration scope
- `apps/node-service/src`: 41 TypeScript source files, including older dependencies absent from recent milestone ZIPs
- `apps/dashboard/src`: React dashboard and CSS, plus entrypoint
- `packages/shared/src`: reconstructed DirectShow device types
- root npm workspaces, per-app manifests and TypeScript configurations, Vite configuration, HTML entrypoint

## Verification performed
- All local relative TypeScript imports in node-service resolve to files in this archive.
- TypeScript parser reports no syntax errors across node-service and dashboard sources after fixing the dashboard's multi-element conditional JSX.
- ZIP contents/integrity verified.

## NOT VERIFIED
- `npm install`, TypeScript type checking, dashboard build, and live Windows/FFmpeg/camera integration.
- Dependency installation could not complete in the build environment because npm registry DNS was unavailable and the required dependencies were not cached.
- Source files were recovered from multiple milestone archives, so some old APIs and newer features may not yet be mutually compatible. Treat this as an **integration candidate**, not a production release.

## Suggested first Windows validation
1. Run `npm install`, then `npm run typecheck` and `npm run build`.
2. Address reported TypeScript errors before running with live cameras.
3. Start the node service and dashboard, test camera enumeration and preview with one webcam.
4. Test local recording and audio, then a private YouTube stream.
5. Scale to multiple cameras only after one-camera capture and shutdown are reliable.
