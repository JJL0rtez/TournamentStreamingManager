# TournamentStreaming: Replay, Simulation, and Regression Drills

This is a substantial integrated milestone that adds an offline incident
simulation engine, JSON CLI, HTTP endpoints, React operator panel, test
scenarios and regression comparison. The replay does NOT start, stop, monitor,
or alter live streams. Its input consists of synthetic JSON signal events.

## Included features

1. Deterministic timeline replay with stable event ordering.
2. Multi-PC and multi-ring incident simulation.
3. Video, audio, encoder, YouTube, network, and disk signals.
4. Severity escalation from degraded to failed.
5. Incident recovery when signal returns to OK.
6. Unresolved incident tracking at the end of the scenario.
7. Assertions for expected signals and detection deadlines.
8. Regression comparison between baseline and candidate scenarios.
9. CLI JSON report export, with nonzero exit codes on failed assertions.
10. HTTP `POST /api/simulation/replay` endpoint.
11. HTTP `POST /api/simulation/compare` endpoint.
12. Dashboard scenario JSON editor and file import.
13. One-click example two-PC failure and recovery drill.
14. Dashboard incident table, expectation results and JSON report download.
15. Input validation, event and duration bounds, no disk writes on server.
16. Six automated unit tests and one exercised CLI scenario.

## Install

Extract into `C:\Projects\TournamentStreaming` preserving paths, after the
Multi-PC Fleet Bulk release. Files replaced: `remote-nodes.ts` and `App.tsx`.
Back up and reconcile any independent local modifications to these files.

Run in PowerShell (one physical line per command):

`cd C:\Projects\TournamentStreaming; node --experimental-strip-types --test tests/incident-replay.test.mjs`

`node --experimental-strip-types scripts/replay-scenario.mjs run scenarios/multi-pc-failures.json`

`npm run typecheck; npm run build`

## API request shape

`POST /api/simulation/replay` JSON body: a version 1 scenario as in
`scenarios/multi-pc-failures.json`. `POST /api/simulation/compare` JSON body:
`{"baseline":<scenario>,"candidate":<scenario>}`.

## Important limitations

- This simulates incident signals and recovery bookkeeping, not actual
  FFmpeg video playback or production detection algorithms.
- It does not yet inject faults into real capture workers, evaluate real
  YouTube health, or test recording crash recovery.
- Full TypeScript/React build and Windows tests are not verified here.
- Dashboard App.tsx is based on the prior fleet release snapshot and could
  overwrite later local edits. Reconcile before applying.
