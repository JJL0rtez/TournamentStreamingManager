# TournamentStreaming Multi-Computer Fleet Readiness Bulk

## Implemented

1. Read-only fleet-wide health endpoint `GET /api/nodes/fleet-readiness`.
2. Parallel health probes with a 2.5-second timeout per remote request.
3. Remote recording-storage health, capture health and event-license status.
4. Aggregated online/offline/warning counts and per-node latency.
5. Explicit warning that a lost connection does not prove capture stopped.
6. No self-fetch of the local service through a potentially public interface.
7. Strict peer configuration and shared node authentication retained.
8. Added safe proxy routes for read-only storage, USB and entitlement data.
9. Read-only method enforcement on all newly proxied routes.
10. Bounds on forwarded query and response size.
11. A collapsed React dashboard fleet-health panel, refreshing every 30 seconds.
12. Automated tests for fleet summary, duplicates and unsafe identifiers.

## Apply

Extract into the project root. `remote-nodes.ts` is a full replacement based on
original source; `App.tsx` is based on the prior operator workflow snapshot.
Reconcile any independent local edits before overwriting.

PowerShell commands (one physical line each):

`cd C:\Projects\TournamentStreaming; node --experimental-strip-types --test tests/fleet-readiness.test.mjs`

`npm run typecheck; npm run build`

## Limitations

This is a monitoring and safe proxy release, NOT automatic network failover,
remote capture takeover, distributed scheduling or guaranteed stream recovery.
The local node uses a placeholder for local fleet detail; its own local health
endpoints provide actual metrics. Remote nodes must be on the same version for
new status endpoints. No Windows or full-app build test was possible here.
