# TournamentStreaming: Multi-Link Remote Failover

This patch upgrades the existing remote-node proxy, fleet readiness, and node
status requests to support a primary address plus optional LAN and Tailscale
addresses per remote computer. It is not a capture failover system.

## Implemented

1. Multiple operator-configured endpoints per peer.
2. Tailscale-first, LAN-second, primary-third initial priority.
3. Sticky last-successful link for subsequent monitoring requests.
4. Bounded timeouts on every request.
5. GET-only retry on connection failure or HTTP 502/503/504.
6. No automatic retries for POST/PUT, preventing duplicate capture starts.
7. No retry for HTTP 401 or other non-transient application responses.
8. Validate peer origins, reject embedded credentials, paths, queries and unsafe schemes.
9. Remove duplicate endpoint URLs.
10. Preserve existing `NODE_PEERS` configuration using `url` only.
11. Integrate with fleet health, node status and remote proxy.
12. New read-only `GET /api/nodes/transports` diagnostic endpoint.
13. Six automated behavioral tests.

## Example configuration

Set `NODE_PEERS` to a JSON array (this example is documentation, not a ready
PowerShell environment assignment):

```json
[{"id":"second","name":"Secondary PC","url":"http://192.168.1.51:3001","lanUrl":"http://192.168.1.51:3001","tailscaleUrl":"http://100.64.1.23:3001","token":"REPLACE_WITH_A_RANDOM_24_PLUS_CHARACTER_SECRET"}]
```

`url` is required and backward compatible. `lanUrl` and `tailscaleUrl` are
optional. The node must be reachable at these origins and have its existing
node token configured. Never place credentials in URL strings.

## Install

Extract into the project root. These two source files replace the existing
`apps/node-service/src/remote-nodes.ts` and add `peer-transport.ts`. The
`remote-nodes.ts` baseline comes from the last available fleet/replay patch.
Reconcile local edits before replacing it.

```powershell
cd C:\Projects\TournamentStreaming; node --experimental-strip-types --test tests/peer-transport.test.mjs
```

```powershell
npm run typecheck; npm run build
```

## Limitations

- No camera migration between computers. Local FFmpeg capture remains independent.
- A POST/PUT timeout can mean the operation completed remotely; check status
  before retrying manually. We intentionally do not replay mutations.
- No automatic Tailscale installation or network adapter switching.
- No automatic shared secret rotation or certificate pinning.
- Transport history is in-memory and resets with Node.
- Six Node behavioral tests passed in Linux. Full app build, real network
  disruption and Windows tests have not been run here.
