# YouTube relay recovery batch

Optional `TOURNAMENT_RELAY_AUTO_RECOVER=1` enables bounded relay restarts after unexpected FFmpeg termination. Default is off.

- Three retries per 10-minute window, delayed 2/4/8 seconds.
- A manual stop cancels scheduled retries; stopAll includes pending relays.
- Retry state is exposed via `recoveryStatus()` for future dashboard use.
- A failed relay does not restart other cameras.
- Existing coordinator leases remain owned by the coordinator; this patch does not implement lease reacquisition.

**Important:** This is FFmpeg process recovery, not proof of YouTube playback or ingest health. Test on non-production streams before enabling. The TypeScript build and hardware behavior require local verification.
