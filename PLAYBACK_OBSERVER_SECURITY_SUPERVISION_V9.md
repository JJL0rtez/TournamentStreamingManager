# v9: Independent observer authentication and bounded supervision

This patch is cumulative through v8. It does not mutate capture, recording, ring leases, or YouTube relay state.

## Stronger authentication

The receiving Node service now supports per-observer secrets using `TSM_PLAYBACK_OBSERVER_TOKENS`. Set it to a JSON object mapping observer IDs to distinct strong secrets, for example:

```json
{"observer-pc2":"REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARS","observer-truenas":"REPLACE_WITH_ANOTHER_RANDOM_SECRET_AT_LEAST_32_CHARS"}
```

Choose each secret using a cryptographically secure generator, and keep the real file or environment value private. The names must match the `observerId` in each worker's observer JSON. Every observer uses `TSM_PLAYBACK_OBSERVER_TOKEN` locally for **its own** secret when pushing reports. The receiving Node service only needs `TSM_PLAYBACK_OBSERVER_TOKENS`; it does not need the old shared token.

While `TSM_PLAYBACK_OBSERVER_TOKENS` is configured, a missing, malformed, empty, duplicate-token or invalid-ID token mapping fails closed; the server **will not** fall back to `TSM_PLAYBACK_OBSERVER_TOKEN`. Credentials are compared using constant-time equality for matching-length strings. Max 16 observer IDs and 32 to 512 characters per secret. The read-only dashboard never receives secrets.

Backwards compatibility: without `TSM_PLAYBACK_OBSERVER_TOKENS`, the existing single shared `TSM_PLAYBACK_OBSERVER_TOKEN` still works for v7/v8 observers. Change to per-worker tokens when deploying multiple independent machines.

## Independent worker supervision

From the **observer host**, after setting `TSM_PLAYBACK_OBSERVER_ENDPOINT` and its own `TSM_PLAYBACK_OBSERVER_TOKEN`, run:

```powershell
node tools/playback-observer-supervisor.mjs --config observer.json --output observer-report.json
```

The supervisor starts the existing independent playback worker, restarts it after a failure, and imposes a 5-restart-per-10-minute budget with exponential delay of 2, 4, 8, 16, and 30 seconds. A run lasting at least ten minutes resets the budget. When exhausted, it exits nonzero for operator review instead of looping indefinitely. Ctrl+C or termination is forwarded and stops any pending restart. The supervisor deliberately does **not** start or stop live cameras, recordings, or YouTube relays.

For unattended operation, use an approved service manager with a suitably restricted account. Do not configure a second external restart loop that defeats the supervisor's capped budget. This patch does not install a Windows service, edit firewall rules, or distribute credentials.

## Verification

- 441/441 native `.mjs` regression tests passed under Node 22.
- 4/4 new authentication tests and 3/3 new restart policy tests passed in focused runs.
- TypeScript/module resolution and the full `.mts` suite still require `npm run typecheck`, `npm run build`, `npm run test:all` on the Windows installation.
- Requires real remote worker/receiver connectivity to validate HTTPS and FFmpeg decoding in production.

## What this does not yet implement

OAuth-authenticated YouTube Live Streaming API health, YouTube audience playback verification, Windows service installation, automated remote deployment, or end-to-end hardware acceptance. A successful FFmpeg decode remains an independent transport observation, not proof that YouTube users see the live stream.
