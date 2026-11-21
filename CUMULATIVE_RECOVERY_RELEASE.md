# TournamentStreamingManager: Cumulative Recording and Process Recovery

This ZIP is a **cumulative patch** against the project snapshot `TournamentStreaming(4).zip`.
It incorporates the recording-integrity, lifecycle, capture coordination, capture recovery, YouTube relay recovery, and current dashboard recovery-visibility changes. You do **not** need to install intermediate patches when extracting this ZIP onto that snapshot.

## Changes

1. Recording integrity: bounded, sampled segment verification, corrupt/missing segment detection, parallel FFprobe verification, graceful handling of missing recording directories.
2. Recording lifecycle: FFmpeg startup verification, serialized start and stop operations, failure cleanup.
3. Capture lifecycle: reserve camera identifiers and UDP ports during startup, include in-flight starts in Stop All, safe retryable stops.
4. Capture auto recovery: opt-in, bounded retries with exponential delay, per-camera attempt budgets and manual-stop cancellation.
5. YouTube relay auto recovery: opt-in, bounded retries, per-camera cancellation, redaction of streaming credentials in diagnostics.
6. **New:** standalone relay retries require the local capture to still be running. Retries are not attempted through this path in distributed/independent coordination modes.
7. **New:** read-only `/api/operations/process-recovery` response exposes capture and relay retry telemetry, pending attempts, event history, and recent FFmpeg-side events. It never returns stream keys. Event logs are bounded to 150 in-memory records per process type and reset when the backend restarts.
8. **New:** collapsed dashboard tool under Live Health, `FFmpeg Process Recovery and Relay Retries`, shows both recovery subsystems and recent events, polling every 10 seconds while the tab is visible.

## Installation

1. Make a backup or commit changes to the project.
2. Extract this ZIP into `C:\Projects\TournamentStreaming` and overwrite matching files, preserving `apps/...` and `tests/...` paths.
3. It is a patch, not the whole project. Keep your existing configuration and unmodified files.
4. Validate with the following **one-line commands**, each run separately:

   npm run typecheck
   npm run build
   npm run check:integration

## Enable process auto recovery for hardware testing

These are opt-in and should be tested with a single noncritical camera before a tournament:

   $env:TOURNAMENT_CAPTURE_AUTO_RECOVER="1"
   $env:TOURNAMENT_RELAY_AUTO_RECOVER="1"

Restart the Node service in the shell where the environment values are set.
Keep automatic recovery disabled when not testing and during distributed/leased operations unless that deployment's corresponding coordination policy has been validated.

## Operational caveats

* YouTube FFmpeg progress is not YouTube ingest or viewer-playback verification.
* Process recovery is not guaranteed to recover a lost USB device or a stopped local capture.
* These changes are not validated with the user's physical cameras or live YouTube ingestion.
* This release passed TypeScript syntax/transpilation checks of the changed service and UI modules, **not** the project's full typecheck/build. The local dependencies were incomplete; full compilation must happen on the user's installed project.
