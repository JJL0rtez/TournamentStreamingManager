# TournamentStreaming bulk release: Recording-disk readiness

This release adds a substantial operational feature rather than another policy helper.

Seven integrated capabilities:
1. `GET /api/storage/readiness` with a configurable tournament workload
   (cameras, recording Mbps, streaming Mbps, hours, safety margin).
2. Estimated total recording storage required for the tournament.
3. Required aggregate sustained recording throughput, with safety margin.
4. Required aggregate network upload bandwidth, with safety margin.
5. Capacity assessment against free space on the *actual recording volume*.
6. `POST /api/storage/benchmark` performs a bounded, opt-in sequential write
   and fsync test in the recording directory, then cleans up the test file.
7. `GET /api/storage/benchmark` reports latest result and running status,
   with duplicate concurrent benchmark rejection.

Defaults: 8 cameras, 8 Mbps recording each, 6 Mbps streaming each, 10 hours,
1.5x safety margin. All are adjustable; eight is a default, not a camera cap.

Example:
GET /api/storage/readiness?cameras=12&recordingMbpsPerCamera=8&streamMbpsPerCamera=6&hours=10&safetyFactor=1.5
POST /api/storage/benchmark with JSON body {"sampleMiB":64}

These endpoints use the existing operator authorization middleware.
A disk benchmark is never run automatically. It writes a temporary file
(16 to 256 MiB) to the recording directory, fsyncs it, and removes it.
It will refuse to run if less than the sample plus 512 MiB is available.

WARNING: this is a sequential write sample, NOT an end-to-end camera recording
soak test. It cannot certify USB stability, NVENC limits or YouTube ingest.
Do not run a benchmark during a live tournament.

Install into the existing project root, preserving paths. `api.ts` is based on
the latest diagnostic-dashboard patch, so reconcile any local edits.

Tests (Node 22+):
`node --experimental-strip-types --test tests/storage-readiness.test.mjs`
`npm run typecheck`
`npm run build`
