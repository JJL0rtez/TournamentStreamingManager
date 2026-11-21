# Tournament Streaming v12: Operator release workflow

This release adds a **local evidence workflow** on top of the existing v11 acceptance gate. It does **not** start cameras, stop streams, deploy hosts, run hardware tests, or automatically certify readiness.

## Why

The v11 release gate required manual JSON editing for all eight hardware drills. v12 lets the event operator initialize a new event plan, record observations safely, inspect progress without revealing private notes, and run the existing release gate.

## Commands (one physical PowerShell line each)

Run from `C:\Projects\TournamentStreaming`:

1. Generate an event-specific plan from the shipped template. **This refuses to overwrite an existing plan** and resets all drills to pending: `npm run release:workflow -- init --output tools/release-event-2027.json`
2. Edit `tools/release-event-2027.json` to set the actual event ID, expected camera count, host report paths, and fleet gate report. The example assumes eight cameras and two hosts; adjust them to the deployment.
3. Check which drills are pending, passed, failed, or stale: `npm run release:workflow -- status --plan tools/release-event-2027.json`
4. After physically testing a drill, record the observation. Example: `npm run release:workflow -- record --plan tools/release-event-2027.json --drill audio-review --status pass --operator "Event operator" --evidence "Reviewed captured audio for every camera during the venue test" --confirm-observed`
5. Record a **failed** drill without approving it: `npm run release:workflow -- record --plan tools/release-event-2027.json --drill network-outage --status fail --operator "Event operator" --evidence "Secondary stream did not reconnect after the network interruption"`
6. Reset a drill to pending: `npm run release:workflow -- record --plan tools/release-event-2027.json --drill network-outage --status pending`
7. Once host acceptance reports and the fleet gate report exist, generate the consolidated release decision: `npm run release:workflow -- check --plan tools/release-event-2027.json --output reports/release-event-2027.json`

The eight required drills remain: `eight-camera-load`, `audio-review`, `recording-integrity`, `usb-camera-recovery`, `youtube-relay-recovery`, `network-outage`, `secondary-pc-failover`, `viewer-playback`.

## Important safety details

- A drill can only be marked `pass` with the explicit `--confirm-observed` flag, an operator label, and meaningful evidence text. The tool never fabricates proof.
- Every change to an existing plan creates a timestamped `.bak` alongside it, then replaces the original via an atomic rename. An exclusive `.lock` file guards simultaneous edits. If a process crashes and leaves the lock, inspect and remove it manually only after checking that no process is updating evidence.
- Console summaries and the release report omit operator names and free-text observations. **The plan and its backup files contain those notes**, so protect them and do not upload them publicly.
- A passing result means `ready-for-operator-review`, **not** an automatic production approval. Freshness requirements still apply, including the maximum three-hour age for acceptance inputs.
- The acceptance workflow does not configure OAuth or verify YouTube account authorization. Real external playback and platform checks are separate.
- The `release:workflow` command returns exit code 1 when acceptance is not ready, and 2 for a malformed plan or operational error. `init`, `record` and `status` return 0 on success.

## Files changed in v12

- `tools/tournament-release-workflow.mjs`
- `tests/tournament-release-workflow.test.mjs`
- `package.json` adds `release:workflow`
- `TOURNAMENT_OPERATOR_WORKFLOW_V12.md`

This ZIP is cumulative against the original source archive, including all v1 through v11 changes.
