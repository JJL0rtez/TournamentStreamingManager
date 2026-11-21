# Capture recovery batch

This cumulative patch includes the preceding capture lifecycle and recording integrity changes.

## Feature

Opt-in bounded FFmpeg capture restart after unexpected process exit. Enable with `TOURNAMENT_CAPTURE_AUTO_RECOVER=1` in the Node service environment. Disabled by default until verified with the actual USB hardware. Each camera gets up to 3 attempts per 10-minute window, delayed 2, 4, and 8 seconds. Retry budgets reset after the window. Failed recovery starts also consume budget. Manual stop cancels pending retries, and Stop All cancels every pending retry. Restart uses the existing capture start path, preserving microphone, quality, output mode, overlays, and recording settings. Each new recording starts a new file, never overwriting the previous segment. `recoveryStatus()` exposes attempts and pending retry status for later API/UI wiring.

## Important

This does not automatically recover a YouTube relay or guarantee reconnection of an unplugged USB camera. It has not been hardware-tested. Restart policy is opt-in for safety. Stop All is not a permanent shutdown: subsequent operator starts remain allowed.

## Verify

`node --import tsx --test tests/capture-recovery-planner.test.mts`
`npm run typecheck`
`npm run build`
