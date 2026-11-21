# Bulk release: connect distributed ring coordination to YouTube lifecycle

This is a source patch, not a standalone application. It integrates the previous distributed coordinator into **all existing YouTube relay start/stop entry points**, including bulk stream operations and capture/session stop routes. The integration patcher backs up api.ts, checks its expected structure, and is idempotent. It deliberately does not overwrite api.ts.

## Install (one physical PowerShell command per line)

Extract into `C:\Projects\TournamentStreaming`, retaining paths. Run:

`cd C:\Projects\TournamentStreaming; node scripts/integration/apply-coordinated-youtube.mjs`

`node --test tests/coordinated-youtube-integration.test.mjs`

`npm run typecheck; npm run build`

Coordinator host, in its own terminal:

`$env:TSM_COORDINATOR_SECRET='REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'; node scripts/coordination/serve.mjs`

Each capture computer must have these environment variables before starting its Node service: `TSM_COORDINATOR_URL` (e.g. `http://100.64.1.23:43177`), `TSM_COORDINATOR_SECRET` (same secret), and `TSM_NODE_ID` (unique alphanumeric machine ID). Ensure each saved tournament assignment has a unique ring identifier containing only letters, digits, underscore, or hyphen. The same event UUID and ring ID must be used across nodes.

GET `/api/youtube/coordination` reports local in-memory claim states, but does not reveal secrets.

## Safety behavior

- No coordinator config or no valid tournament assignment: stream starts fail closed.
- Before starting FFmpeg relay: coordinator claim is acquired.
- Heartbeat loss: existing FFmpeg relay is not interrupted; state becomes uncertain.
- Relay stop: await process shutdown, then release claim. If stop/release fails, ownership remains uncertain and new starts remain blocked.
- Duplicate concurrent starts in one Node process: blocked.
- A different computer with the same event/ring: blocked by the central coordinator.
- Crash/restart: central claims persist and are never automatically stolen, even after expiry. Operator must verify old capture stopped and clear stale claim manually.

## Known limits

- **Local recordings are not yet guarded.** The patch protects YouTube relay starts and stops only. Existing recording starts are still independent.
- The coordinator is a single-host system, not highly available. Network loss blocks new streams.
- In-memory local claim state is lost on a Node crash. Central stale claims remain until operator review.
- FFmpeg spawn failures can be asynchronous, so an uncertain start may retain a claim conservatively.
- Does not validate actual YouTube-side playback, USB hardware, or Windows process ownership.
- Coordinator HTTP must stay on a trusted LAN/Tailscale link, not exposed to the public internet.
- Run the full application typecheck and hardware tests before using live tournament streams.
