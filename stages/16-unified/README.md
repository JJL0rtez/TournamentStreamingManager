# TournamentStreaming unified recording and YouTube ring ownership

This bulk patch closes a specific integration gap: local camera captures, legacy recordings and YouTube relays now share one distributed ring lease per Node process. The earlier YouTube-only coordinator cannot be used simultaneously because it would acquire a conflicting second lease. The included integration installer replaces its facade, not the existing route bodies.

## Install on an existing project

1. Back up or commit local changes. Extract this ZIP into the repository root, preserving paths.
2. If the previous coordinated YouTube patch is NOT installed, run `node scripts/integration/apply-coordinated-youtube.mjs`. This release includes a corrected version of that installer (the previous release incorrectly required exactly one stopAll occurrence).
3. Run `node scripts/integration/apply-unified-capture.mjs` once. The installer backs up `api.ts` and refuses unknown layouts.
4. Run `node --test tests/unified-lifecycle.test.mjs tests/unified-patcher.test.mjs`.
5. Run `npm run typecheck` and `npm run build` on your actual checkout. These commands are NOT run in this release.

## Configuration

Configure `TSM_COORDINATOR_URL`, `TSM_COORDINATOR_SECRET` (at least 32 characters), and `TSM_NODE_ID` (unique per computer) before starting Node. Start the coordinator on a trusted LAN or Tailscale link. Existing event ID and ring assignment must be stable and identical across nodes. The patch fails closed if coordinator configuration is missing. Do not expose the HTTP coordinator on the public internet.

## What is covered

- CameraCaptureManager.start/stop/stopAll, including session bulk starts, restart/recovery routes and single capture routes.
- RecordingManager.start/stop/stopAll, including legacy recording routes.
- YouTubeStreamManager.start/stop/stopAll via the previously coordinated YouTube routes.
- One lease per event/ring, shared across all three kinds of output on one computer. No release until the final managed pipeline stops.
- Failed starts/stops and coordinator disconnects retain an uncertain lease. They do not silently transfer ring ownership.
- GET `/api/captures/ownership` returns in-process ring states without secrets.

## Important limits

- This is a **source-level integration**, not proven production readiness. Actual Windows hardware tests and the full TypeScript build have not been run. The provided source snapshot may differ from the operator's current checkout.
- Unexpected FFmpeg exit leaves the lease held until manual investigation. This is deliberate. Process supervision still needs a reliable way to reconcile and recover safely.
- If the Node process dies, in-memory ownership is lost. The central coordinator retains the claim until manual clearance. Do not clear it without verifying that FFmpeg and YouTube outputs have stopped.
- An asynchronous FFmpeg start may fail after its start promise resolves. The lifecycle still holds the lease until the operator stops or investigates.
- The wrapper's stopAll only knows managed active sessions; untracked orphan processes require the existing supervisor and manual audit.
- Coordinator is a single authority, not a highly available cluster. Do not start a second coordinator using an independent state file.
- The earlier remote-control dashboard patch is separate; this release does not overwrite App.tsx or reintroduce the read-only remote restriction.
- This patch does not address end-to-end diagnostic watermark enforcement, licensing, installer completeness, or YouTube-side live health validation.
