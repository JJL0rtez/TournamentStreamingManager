# Cumulative Live Operations Batch

Baseline: TournamentStreaming(4).zip + every correction through Cumulative Test Fixes v4.
This ZIP is cumulative and replaces all earlier incremental patches. Extract directly into `C:\Projects\TournamentStreaming`, overwriting files.

## New functionality
- Read-only `/api/operations/live-readiness` endpoint consolidates assigned rings, running captures, recording-enabled flags, local relay process health, and scheduled retries.
- Flags missing/stopped assigned captures, stale frames (over five seconds), and stalled/error local relays as critical.
- Flags inactive recording, diagnostic capture mode, connecting relays, and scheduled retries as warnings.
- Separately lists active captures/relays not assigned to this event.
- New `Live Ring Operations and CSV Report` collapsible panel in Live Health, with severity filters, 10-second visible-tab polling, manual refresh, and CSV download.
- CSV protects against formula injection in operator-supplied strings. No YouTube keys, local recording paths, or coordinator credentials in the snapshot.
- Four native TypeScript tests covering healthy and failed rings, recovery state, and unassigned processes.

## Important scope
- This is **local-node readiness only**. A second host requires viewing that host separately.
- "Recording enabled" is configuration/process state, not validation of resulting MKV contents.
- An active FFmpeg relay does **not** establish YouTube ingest or viewer playback health.
- Missing optional relays are informational, not a failure.
- This is operator assistance, not automatic start/stop control.

## Validation
Run one command at a time in PowerShell:

    npm run typecheck
    npm run build
    npm run test:all

This build was tested with Node v22.16.0 native type stripping for the focused new tests. Windows UI build and physical cameras must be verified on the target machine.
