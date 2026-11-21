# Remote capture controls: targeted App.tsx fix and operator workflow

This patch fixes the exact `requestNode` callback reported around App.tsx line 3372. The existing remote API proxy already supports a restricted set of POST operations, but the dashboard rejects them unconditionally and disables camera buttons.

## What changes

- Remote capture and YouTube stream buttons can be enabled for a selected remote node with an explicit, session-only checkbox and confirmation.
- Remote mutations remain disabled by default. The checkbox is not stored or synchronized across browsers.
- Only capture start, capture stop, YouTube start/stop and session start/stop are permitted by the new client guard. Other remote settings remain local-only.
- The backend's existing operator authentication, node shared secret and strict proxy route allowlist remain mandatory. The client checkbox is **not** an authorization boundary.
- Mutating requests use the existing peer transport, which deliberately does not retry across links. A timeout can mean the operation succeeded; check remote status before trying again.
- The installer modifies only the NodeDashboard section, checks expected anchors, backs up the current App.tsx and is idempotent. It does not replace the entire file.

## Apply

Extract at `C:\Projects\TournamentStreaming`, then run each command as one physical PowerShell line:

`cd C:\Projects\TournamentStreaming; node scripts/integration/enable-remote-capture-controls.mjs`

`node --test tests/remote-control-integration.test.mjs`

`npm run typecheck; npm run build`

**Test fixture note:** The test uses your existing `apps/dashboard/src/App.tsx` as its fixture if you set `TSM_TEST_APP_SOURCE`; otherwise it searches the local project. Run the installer first, and the test should use the `.pre-remote-controls-*.bak` backup as fixture, or a clean copy of App.tsx from the previous patch. The tests must not modify your working App.tsx.

## Remaining work

- Remote controls are for capture and YouTube only, not device configuration, recording recovery or stream-key profile editing.
- The coordinator still does not protect every recording path; do not interpret this as completed distributed recording ownership.
- The server-side operator authentication must be configured before enabling remote commands.
- Test with two real PCs before using this during a live event. No Windows hardware test has been run here.
