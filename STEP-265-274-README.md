# Steps 265–274: Core application verification baseline

This is a source-only patch based on the uploaded project audit. It does not contain runtime settings, encryption keys, recordings or dependencies.

## Installation
Extract into `C:\Projects\TournamentStreaming`, overwriting the root `package.json` and adding `scripts/` and this README.

## Commands (each on one physical PowerShell line)
- `cd C:\Projects\TournamentStreaming; npm run check:core`
- `cd C:\Projects\TournamentStreaming; npm run check:baseline`
- `cd C:\Projects\TournamentStreaming; powershell -ExecutionPolicy Bypass -File .\scripts\windows-baseline.ps1`
- With the backend already running: `cd C:\Projects\TournamentStreaming; npm run check:api`

## What these checks do
- 265–274: Ten explicit source-presence gates covering workspaces, build scripts, camera discovery, capture, recording, YouTube, sessions, remote nodes and health routing.
- Baseline command: runs source gates, workspace TypeScript checks and dashboard build. Exits nonzero if a command fails.
- Windows script: captures separate logs under `test-results/`, continues past failures and exits nonzero if any check fails.
- API smoke: read-only GET requests to health, session, stream status and capture status. No camera/stream state changes.

## Limits
Source-presence gates are not unit or integration tests. A successful build does not prove hardware performance. API smoke requires a running backend and may fail when authentication is configured. No YouTube keys or camera hardware are required for the static gates.

## Next priorities
Fix any build errors; add process-isolated tests for capture/recording/stream state transitions; run 1/2/4/8 camera soak tests; then implement presentation, ring display and billboard features.
