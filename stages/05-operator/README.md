# TournamentStreaming: Operator Workflows Bulk Patch

This patch integrates three previously backend-only subsystems into the actual
React operator dashboard, with multiple end-to-end UI actions:

EVENT PASS WORKFLOW
1. Per-node license status, tier, activation and expiry display.
2. Install a signed JSON event pass from file without starting the countdown.
3. Confirm explicitly before activating the ten-day countdown.
4. Prevent license mutation from read-only remote dashboards.
5. Show whether free-tier enforcement is enabled on the server.
6. Display license and event identifiers, and node seat maximum.

RECORDING DRIVE WORKFLOW
7. Set cameras, record/stream bitrate, event hours and safety factor.
8. Calculate storage required and available disk capacity.
9. Calculate required sustained write and aggregate upload bandwidth.
10. Display measured disk throughput and compare against requirements.
11. Run an explicitly confirmed 64 MiB recording-directory write test.

USB TOPOLOGY WORKFLOW
12. Scan Windows PnP USB topology and show physical controller/port paths.
13. Save an in-memory USB port baseline on the local node.
14. Compare connected/disconnected/moved devices against the baseline.
15. Show Windows mapping limitations and read-only remote status.

Eight source-level integration tests are included.

This patch adds two React components and updates App.tsx, but does not replace
api.ts. The backend endpoints must already exist from the earlier storage,
USB and licensing bulk patches. No changes to the recording engine or streams.

IMPORTANT: App.tsx is based on the last dashboard snapshot available in this
conversation, not on any subsequent local changes. BACK UP and reconcile your
current App.tsx before overwriting. The new components can be added separately
if you have independent edits.

Extract into project root, preserving paths.

Tests:
node --test tests/handoff-operator-panels.test.mjs
npm run typecheck
npm run build

Source-level tests passed in the patch environment. The full React build and
live Windows integration remain unverified.
