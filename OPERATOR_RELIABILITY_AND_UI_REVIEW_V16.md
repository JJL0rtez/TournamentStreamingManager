# Operator reliability and dashboard cleanup (v16)

This is a cumulative patch relative to TournamentStreaming(4).zip. It includes every path from v15 and the v16 changes. Stop any previews opened by earlier versions of the presentation display manually before updating. Restart the Node service and dashboard after copying files.

## Implemented

1. Notifications: the count in the toolbar is the number of active incidents. The separate new count is unacknowledged incidents. Acknowledging removes that incident's banner while retaining it in the active list until the underlying problem clears. The next new incident becomes the banner. Dynamic metric text no longer undoes acknowledgement. Resolved incidents and severity transitions clear old marks. Banner dismissal does not acknowledge an incident. Missing cameras are not reported before the initial device scan has succeeded.
2. Notification bar, diagnostic card surfaces, and operator summaries use the neutral grey, white, gold and red theme. Connected and healthy status indicators remain green.
3. Assignment validation, preflight results and bulk-action results use one responsive results grid. Storage health shows remaining space without embedding thresholds in the normal status line; warnings remain visible when relevant.
4. Camera settings/stream-key and Device details use matching simple disclosure headings. YouTube key input occupies remaining width alongside its Show button.
5. Live Health, Settings, Advanced Tools and Fleet Monitoring share the same outer disclosure styles. Live Health defaults open. The fleet monitoring panels are mounted only when expanded, reducing unnecessary dashboard queries. The independent monitoring worker itself does not depend on this UI.
6. Connected replaces the duplicate API Connected/Online badges for a reachable node, while unreachable nodes show Disconnected. The header still shows the total number of connected nodes. Connection is not proof of working YouTube playback.
7. Multi-camera regression: same-model cameras with distinct DirectShow alternative device IDs can reserve independent captures. Exact matching alternative IDs, logical IDs, verified physical identities and microphone identities still conflict. If either camera input is name-only or has an ambiguous synthetic ID, matching model names still fail closed. The capture capability probe also selects the unique DirectShow ID rather than the friendly name when available. Legacy name-only recording remains conservative. The actual Windows FFmpeg multi-camera path must still be tested with real cameras and separate microphones.
8. Camera Display, Billboard and Ring Assignments have distinct links beside the local node name and separate presentation modes. The Billboard mode displays its existing saved billboard slides and includes a basic announcement editor. Ring Assignments continues to display the shared tournament schedule.
9. Camera Display is now a passive consumer. It opens no cameras and makes no start/stop preview mutations. It rotates through healthy, already-open recording, stream or manually started preview feeds, with a selector to pin one active camera. It samples existing buffered frames for motion ranking and displays only one continuous feed at a time. Closing/hiding/navigating away aborts polling and releases the display's network resources. Already-running recordings, streams and explicitly started previews remain in the operator's control. Start an idle camera's preview from the dashboard if it should participate in rotation. An idle-display automatic preview feature would need separately owned, expiring preview leases and is not enabled here. Existing v15 orphaned previews are not automatically terminated by v16.
10. The manual preview endpoint can reuse an existing shared capture and no longer returns early after adding a busy lock. Display streaming releases timers on response closure, drops frames during HTTP backpressure, and stops when its source becomes inactive. Stale source frames are excluded from rotation.
11. Ring-assignment row times have saved bold/normal, colour and alignment options, independent of division names. The live clock gains 12/24-hour or system-default formatting, seconds toggle, colour, and size. Server-side validation bounds sizes and accepts only safe formatting values. Short slides no longer stack fixed viewport heights underneath the toolbar; the editor and genuinely tall content may still scroll.
12. Ordinary dashboard frame refreshes pause in a hidden tab, and the core status poll prevents overlapping main capture requests.

## Recommended next improvements (not implemented in v16)

Priority 1, before tournament deployment:
- Test two identical physical cameras simultaneously using their distinct DirectShow identifiers and different microphones: record Ring 1, stream Ring 2, then reverse roles. Expand to all eight, including stop/start and failed-camera recovery. Test that a camera display opened/closed repeatedly never changes FFmpeg process counts on idle cameras. Test actual stream playback and recording files as independent checks.
- Record, Stream and Preview should ultimately be independent desired states in a single capture lifecycle. Currently adding disk recording to an existing stream-only pipeline requires an explicit restart; a separately controlled recording branch would allow switching without interrupting YouTube. Avoid silently restarting a live stream. Test partial start and stop failures with real cameras.
- Use persistent hardware identifiers, not friendly names, for camera and microphone assignment everywhere. Current session assignments still use microphone name text, and legacy recording paths still use model labels. Keep explicit pairing for ambiguous same-model microphones. Do not bypass same-device collision checks to make a failed start appear to work.

Priority 2, operator simplification:
- Make the main screen a compact event header, ring cards and a single actionable health strip. Keep start/stop controls always visible; move prior tournaments, templates and configuration to a setup editor. Collapse successful device checks by default, surfacing only exceptions.
- Consolidate Notifications and Operations Alert History into a single incident state model. The v16 top-bar acknowledgement is local to that top-bar state; historical incident workflow and audit remain separate. A unified local/node-backed state would make acknowledgements consistent across PCs without discarding unresolved critical conditions.
- Show the ring label first, user-friendly fault text second, and raw DirectShow/FFmpeg details only under expandable diagnostics. Treat unknown, local FFmpeg healthy, YouTube API healthy, and viewer-playback healthy as distinct states.
- Consider a dedicated Settings page with Devices, Recording, YouTube, Network, and Permissions tabs; keep the daily operator screen focused on tournament operation. Move the many report and acceptance tools to one technical-maintenance page rather than exposing every internal implementation detail in the main GUI.

Priority 3, technical maintenance:
- App.tsx is over 8,000 lines, mixing camera control, polling, device configuration, notifications, reports, and operations panels. Split by feature into components/hooks and CSS tokens. A single polling scheduler with shared caches and request deduplication would reduce traffic from mounted but collapsed panels. Keep independent monitoring in server/worker processes rather than requiring dashboard tabs to be open.
- Replace fragile source-string assertions gradually with component interaction and mocked-API integration tests. Add browser-level tests for banner acknowledgement, distinct display routing, expansion/padding, field alignment, and preview network cleanup. Add a release check that verifies the exact cumulative file manifest and Windows build before publishing.
- Audit legacy recording and preview endpoints for duplicated lifecycle logic and inconsistent identity checks. Keep lease, microphone, port and output guards centralized rather than relaxing them on individual paths.

## Validation

- JavaScript/TypeScript .test.mjs and .test.mts: 701/701 passed in this environment using Node 22 experimental TypeScript transformation and a temporary resolver for local .js-to-.ts imports. This resolver is not part of the patch. Your ordinary npm run test:all continues to use tsx.
- 22/22 targeted tests passed (included in the 701-test run): identity conflicts and safe replacement, notification state, presentation routing and passive lifecycle wiring, and persisted row/clock formatting.
- Full TypeScript project typecheck and production Vite build require the project's installed npm dependencies and were not executed here. Browser visual validation and actual Windows DirectShow/FFmpeg/YouTube operation remain unverified.

On Windows run individually from the project root:

    npm run typecheck
    npm run build
    npm run test:all

Manual checks: acknowledge two active notifications, confirm the new count falls while active count remains truthful; unplug/replug a camera after scan; record one identical model camera and stream another; open each display from its own link; close/hide camera display and confirm no additional camera capture remains; save and reload ring-assignment clock/time formats; inspect short and long slides and all four operator section headers at your normal browser size.
