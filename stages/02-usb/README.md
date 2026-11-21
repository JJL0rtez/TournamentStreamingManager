# TournamentStreaming: Windows USB Topology and Port Stability

Integrated release:
1. Windows PnP discovery of present USB, camera, image and media devices.
2. Windows-reported physical USB root/port path extraction, with confidence.
3. Controller grouping without inventing bandwidth figures.
4. Camera/audio class counts per Windows-reported controller group.
5. JSON topology endpoint `GET /api/usb/topology?refresh=1`.
6. Operator-triggered baseline `POST /api/usb/topology/baseline`.
7. Compare current physical layout to baseline `GET /api/usb/topology/changes`.
8. Detect device connected, disconnected, moved or unchanged by instance ID.
9. 30-second discovery cache and shared in-flight discovery.
10. Timeouts and bounded PowerShell process output.
11. Unsupported-platform behavior (no fake Linux mappings).
12. Five automated topology tests.

Physical controller roots are only available when Windows supplies location paths.
A device without a usable location path is grouped as Unmapped controller.
USB speed, bus utilization, hub bandwidth and USB-over-Cat transport are NOT
measured or certified by this patch. Device instance IDs may change on replug,
in which case the report can show disconnect/connect rather than move.
Baseline is process-local and disappears on Node restart.

Install: extract into project root after prior bulk patches.
`api.ts` includes all previous bulk patches available here, so reconcile
independent edits before overwriting.

Run:
node --experimental-strip-types --test tests/usb-topology.test.mjs
npm run typecheck
npm run build

No USB hardware is available in the test environment. Windows PowerShell
device enumeration must be verified on your Windows host.
