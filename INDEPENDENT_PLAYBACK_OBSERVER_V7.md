# v7: Independent playback observation

This release is cumulative with v6 and all earlier cumulative source patches.

## Scope

- A separately deployable FFmpeg worker (`tools/youtube-playback-observer.mjs`) accepts up to eight explicitly configured **public HTTPS direct media/HLS playback URLs**. It does not scrape YouTube watch pages or use stream keys.
- Bounded, at-most-two-at-a-time FFmpeg decodes observe freeze, black frames, silence and video frames. An unavailable URL, decoding failure or timeout is not reported as healthy.
- Output JSON is written atomically. If configured, the worker pushes a sanitised copy to the Node service over authenticated HTTPS (or localhost HTTP).
- Node service: read-only `/api/operations/playback-observation` and authenticated POST to the same path. An invalid, missing or stale report is unknown, never healthy. An observer token of at least 32 characters is required for ingestion.
- Dashboard: collapsible independent playback observer panel displays reports from the primary Node service. This is not a YouTube Data API integration and cannot guarantee the YouTube audience sees video.
- The remote-node proxy permits only GET for this additional route.

## Example deployment

1. Install FFmpeg on a spare PC, TrueNAS worker, or cloud VM, and install Node.js 22+.
2. Copy the `tools/youtube-playback-observer.mjs` file and `packages/playback-observer/observer.mjs` preserving the project folder structure (or copy the project itself).
3. Copy `tools/playback-observer.example.json` to `observer.json`, replace the placeholder playback URL with an actual public HTTPS **direct media URL**, and assign logical camera IDs.
4. On the **Node service**, set `TSM_PLAYBACK_OBSERVER_TOKEN` to a unique 32+ character secret and restart the service.
5. On the monitoring worker, set `TSM_PLAYBACK_OBSERVER_TOKEN` to the same secret, and `TSM_PLAYBACK_OBSERVER_ENDPOINT` to `https://YOUR-HOST/api/operations/playback-observation` (or `http://localhost:3001/api/operations/playback-observation` when running locally). Transport across machines must use HTTPS through your own reverse proxy. Do not send the token over plaintext HTTP across a LAN.
6. Start the worker: `node tools/youtube-playback-observer.mjs --config observer.json --output observer-report.json`. For a single check, add `--once`.
7. The primary dashboard's **Independent playback observer** panel shows recently reported results.

Example single-line Windows PowerShell commands, run separately after configuring the variables:

```powershell
$env:TSM_PLAYBACK_OBSERVER_TOKEN="REPLACE_WITH_A_UNIQUE_32_PLUS_CHARACTER_SECRET"
$env:TSM_PLAYBACK_OBSERVER_ENDPOINT="https://YOUR-HOST/api/operations/playback-observation"
node tools/youtube-playback-observer.mjs --config observer.json --output observer-report.json --once
```

Do not use the placeholder `example.org` link as if it were a real playback stream. Most YouTube watch-page URLs are NOT direct media inputs for FFmpeg, and many playback manifests have signed URL query parameters. These are deliberately rejected by this prototype observer to avoid leaking credentials or expiring tokens.

## Verification

Focused tests: `node --experimental-strip-types --test tests/playback-observer.test.mjs tests/playback-observation-ingest.test.mts tests/fleet-operations.test.mts`.
Full regression: `npm run typecheck`, `npm run build`, `npm run test:all`. Actual playback testing requires a real public direct-media URL and a separate Windows/TrueNAS/cloud monitoring host.

## Not yet implemented

- OAuth authenticated YouTube Live Streaming API health, viewer statistics, or browser-verified playback.
- Monitoring workers' automatic deployment, service supervision, or signed configuration distribution.
- Per-camera report push from many independently reporting hosts to the same API. The current ingestion endpoint stores the most recent whole observer snapshot only. Run one observer with up to eight camera URLs for this configuration.
