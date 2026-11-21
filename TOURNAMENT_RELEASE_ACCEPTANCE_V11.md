# Tournament Streaming v11: Event release acceptance

This patch adds a **read-only final acceptance gate**, not automatic deployment approval.
It does not start, stop, or control any recording or streaming process.

## Existing prerequisites

1. Run `npm run typecheck`, `npm run build`, and `npm run test:all`.
2. On each streaming host, run the existing acceptance tool with a host-specific plan: `node tools/tournament-deploy.mjs --plan tools/deploy.example.json`. Replace the example paths and camera configurations first. Use independent host IDs.
3. Consolidate the produced reports using the existing `node tools/tournament-gate.mjs --manifest tools/gate.example.json --output reports/tournament-gate.json`. Configure paths for the actual hosts and assigned rings.
4. Inspect physical recordings, microphone audio, USB recovery, YouTube platform health, actual viewer-side playback, network interruption, and secondary-PC recovery. Do not simulate operator sign-off from automatic unit tests.

## Release gate configuration

Copy `tools/release.example.json` to a separate event-specific JSON file and edit it:

- `eventId`: event label used in the report
- `expectedCameras`: total across all hosts, 1 to 8
- `gateReport`: path to fleet gate output, relative to release JSON
- `deployments`: each host ID and its deployment report path
- `maxAgeMinutes`: 1 to 10080, default 180, internally capped at 180 for acceptance reports
- `drills`: operator evidence with `id`, `status: "pass"`, `observedAt` ISO timestamp, `operator`, and a meaningful `evidence` description

Eight drills are required: `eight-camera-load`, `audio-review`, `recording-integrity`, `usb-camera-recovery`, `youtube-relay-recovery`, `network-outage`, `secondary-pc-failover`, and `viewer-playback`. Mark drills `pass` only after actually performing them. The example intentionally has all drills pending and will fail.

From project root, run one physical line in PowerShell:

`npm run release:check -- --plan tools/release.example.json --output reports/release.json`

Exit code 0 means all supplied evidence passed initial acceptance and **requires operator review**, not that production is automatically certified. Exit code 1 means missing, stale, failed or incomplete evidence. Exit code 2 means invalid input or an execution problem.

## Safety and provenance

Reports contain SHA-256 hashes of input JSON files to facilitate later comparison, but no OAuth tokens, stream keys, access URLs, operator names, or free-text drill evidence. The original release plan retains operator evidence locally. Do not upload a plan containing personal information to public storage. No network requests or live camera mutations are performed by this tool.

## Scope boundary

This gate does not validate live YouTube access by itself. YouTube status and playback evidence must be verified separately and documented. Hardware testing requires the physical machines, USB cameras, microphones, and external stream availability.
