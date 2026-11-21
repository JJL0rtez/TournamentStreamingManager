# Cumulative integrated recovery and test-runner update

Baseline: TournamentStreaming(4).zip. This archive supersedes ALL preceding patch ZIPs.
Extract into C:\Projects\TournamentStreaming, preserving folders and overwriting files.

New since last cumulative release:
- Manual starts now cancel scheduled automatic capture recovery and reset retry budget.
- Retry-triggered starts retain their own retry history, with identity checking before any cancellation cleanup.
- Capture recovery status includes whether recovery is enabled and the next scheduled retry time.
- Relay retry timers are generation-fenced to avoid old timers acting on a new session.
- Added cross-platform `npm run test:all` to enumerate every .test.mjs and .test.mts without shell glob differences.
- Added five recovery regression tests.

Run on Windows AFTER npm install:
  npm run typecheck
  npm run build
  npm run test:all

Local testing on Node 22 with experimental TypeScript stripping (native .mjs test files only):
  433 assertions: 417 passed, 16 failed (see TEST_RESULTS.md).
  Full .mts suite, full typecheck, build, and hardware tests not completed here.

Auto-recovery is still opt-in:
  $env:TOURNAMENT_CAPTURE_AUTO_RECOVER="1"
  $env:TOURNAMENT_RELAY_AUTO_RECOVER="1"
Test with one camera first. YouTube process progress does not prove YouTube audience playback.
