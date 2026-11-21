# v8: Multiple independent playback observer workers

This release is cumulative with v7. It changes no capture, recording or YouTube relay controls.

## Changes
- Independent observers can report concurrently using a stable `observerId` in `observer.json` (letters, numbers, `_` and `-`; 1-64 characters). An older worker without `observerId` is accepted under the ID `default`.
- The primary Node service holds up to 16 observer snapshots, accepting up to 8 cameras per worker. An observer's report replaces only its own previous report, and delayed reports cannot roll its state backward.
- Per-worker stale status is preserved. Stale workers do not claim healthy playback. Duplicate camera IDs from multiple fresh workers are surfaced as collisions and flagged as warnings, rather than silently taking one as authoritative.
- The read-only dashboard shows observer ID per camera, stale observers and collisions. Observer reports are filtered to safe public fields and never claim YouTube platform verification.
- Observer-side `observerId` is included in local JSON reports and authenticated API submissions.
- Backwards-compatible with v7 POST schema and top-level GET fields.

## Setup
Edit `observer.json` on each monitoring host and use a different `observerId` (e.g., `observer-truenas` and `observer-pc2`). Assign camera IDs intentionally. Keep the same shared strong ingestion token on each authorized worker and the receiving node. Install the cumulative ZIP at the project root, then run the normal `npm run typecheck`, `npm run build` and `npm run test:all` checks.

## Security limitations
The single shared observer token authenticates reports but does not cryptographically bind an individual observer ID to a host. A token holder can submit another ID. For stronger multi-tenant isolation, use per-observer keys and managed enrollment in a future release. A compromised observer can misrepresent its media decoder results. The checks still are not YouTube Live API or audience-side verification.

## Verification
16/16 focused tests passed with Node 22 TypeScript stripping. A broad Node 22 runner executed 600 entries with 594 passing and six unable to load due to this environment's missing `.js`-to-`.ts` module resolution and unsupported parameter-property syntax. Those six are runner-environment failures, not confirmed application test failures. Run the full suite with the installed project toolchain on Windows.
