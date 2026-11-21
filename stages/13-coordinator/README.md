# TournamentStreaming distributed capture coordination, bulk release

This is an additive patch. Copy the folders to the existing repository. No existing application source files are overwritten.

## What is implemented

- Central lease coordinator using a single-writer file lock and atomic state replacement.
- Per-event, per-ring exclusive claims across machines that use the same coordinator.
- HMAC-signed HTTP requests with timestamp replay window (30 seconds).
- Explicit owner/session/lease token for renewal and release.
- Lease renewal and heartbeat callback, with refusal to automatically reassign expired leases.
- Operator audit and manual stale-claim clear requiring explicit capture-stop confirmation.
- GuardedRelay adapter which acquires before calling the existing stream starter, and releases only after stop finishes.
- CLI service and end-to-end local HTTP self-test.
- Automated tests for concurrency, conflicts, stale ownership, authentication and lifecycle ordering.

## Run

Run tests: `node --test tests/distributed-claims.test.mjs`

Run local self-test: `node scripts/coordination/selftest.mjs`

Start coordinator on the host PC (PowerShell, one physical line):
`$env:TSM_COORDINATOR_SECRET='REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'; node scripts/coordination/serve.mjs`

For multi-PC deployment set TSM_COORDINATOR_HOST to a dedicated LAN/Tailscale IP, use the same secret on all nodes, and restrict access to trusted computers via Windows firewall. Do not expose the coordinator directly to the internet or use plain HTTP across untrusted networks. A single coordinator host is required. If it is unreachable, new stream starts fail closed.

Audit: `node scripts/coordination/audit.mjs`

Manual stale claim clear (ONLY after verifying FFmpeg and YouTube are stopped on the owning computer): `node scripts/coordination/clear-stale.mjs EVENT_ID RING_ID CONFIRM_ALL_CAPTURE_STOPPED`

## Important integration boundary

The existing application does not yet call GuardedRelay automatically. Wire it into the actual API start/stop lifecycle before relying on it for duplicate-stream protection. The adapter intentionally does not release claims after failed stop, so uncertain capture state remains blocked. Recording ownership and FFmpeg process registry integration also remain to be wired. A coordinator crash, disk failure, or split-brain coordinator can still require manual operator intervention.

## Security and reliability caveats

The HMAC timestamp window limits old-request replay but does not prevent replay of an identical valid request within 30 seconds. Treat the secret as sensitive. The coordinator is designed for a single authoritative host and persistent local disk, not a shared SMB folder or multi-primary cluster. The lock file is deliberately not auto-removed after a crash; manual investigation is required. Lease expiry never automatically transfers ownership because FFmpeg may still be alive. Heartbeat loss should trigger a visible incident and prevent new starts; do not kill live captures solely due to a transient network interruption.
