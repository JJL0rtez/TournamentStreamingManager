# v20: Preview reliability, camera settings layout and favicon

## Changes
- In presentation camera settings, the preview occupies 25% of the desktop content width, with a stable aspect-ratio container to prevent feed switches and missing frames from pushing the editor vertically. Full display mode is unchanged; small screens receive a readable preview.
- A charcoal/gold camera favicon with a red recording dot replaces the stock Vite icon. SVG and multi-resolution ICO are included and linked from index.html.
- Camera-card JPEG polling now runs within each card. Removed the dashboard-wide 200ms state update. Each card awaits its current request, aborts requests after four seconds or when hidden/unmounted, releases old object URLs, and backs off on errors.
- FFmpeg process pipe errors are handled rather than becoming unhandled EventEmitter errors. The preview manager conservatively retains its process reservation until the child actually closes and logs unexpected exits. Restarting a stale preview entry opens a fresh preview instead of claiming success for the old one. JPEG parsing retains split markers and bounds incomplete data.
- Known swscaler deprecated-pixel-format warnings do not mark a preview as failed. Preview FFmpeg uses error-only logging; this does not change the requested input/output format or claim to fix colour conversion.
- The legacy preview, capture, recording, and YouTube relay processes receive pipe error guards. Background resource sampling catches failed promises. A Node fatal-error monitor observes failures without suppressing normal process termination. A React error boundary offers a recoverable browser error screen and logs rendering failures.

## Validation
- 724 passed / 0 failed / 1 optional media test skipped, using Node's TypeScript transformation with a temporary local resolver.
- Seven new tests, including independent synthetic child-process preview failure/restart, EPIPE handling, fragmented JPEG parsing, and layout/polling wiring.
- Syntax parsing of TS/TSX source. Full dependency-backed TypeScript compilation, Vite production build, browser layout rendering and real Windows DirectShow testing remain outstanding.
- The provided swscaler messages alone do not establish the cause of the reported whole-app crash. This patch corrects concrete failure risks without declaring the crash reproduced or resolved.

## Installation and diagnosis (PowerShell)
Stop active streams/recordings before restarting the application. Extract this cumulative patch into C:\Projects\TournamentStreaming, retaining the directory structure. Run `npm run typecheck`, `npm run build`, `npm run test:all` separately.

For crash reproduction, stop the existing Node watcher first (do not start another service on port 3001) and run:

```powershell
npm run start --workspace=@tournament/node-service 2>&1 | Tee-Object -FilePath .\node-crash.log
```

Start the dashboard in another terminal as usual (`npm run dev`). If the dashboard stops responding, open a third terminal without restarting Node and run:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/health -TimeoutSec 5
```

If this returns status ok, the Node process still answers; inspect the browser F12 Console and Network tabs. If it fails, inspect the Node terminal and node-crash.log. A successful health response does not establish that capture or all other routes work. The read-only preview status endpoint can be checked with:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/previews -TimeoutSec 5 | ConvertTo-Json -Depth 8
```

Copy the first actual exception/exit and stack trace. Redact keys, passwords, tokens, and any sensitive paths before sharing logs. Do not kill every FFmpeg process on the machine, as some may still be recording or streaming.
