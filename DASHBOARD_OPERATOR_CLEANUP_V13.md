# TournamentStreamingManager v13: operator dashboard cleanup

This ZIP is cumulative relative to `TournamentStreaming(4).zip` and supersedes v1 through v12. Extract at the project root without flattening directories.

## Changes
- Primary action buttons restored to blue in App.css, including hover styling.
- Cameras and individual camera actions moved ahead of the large diagnostic workspaces.
- Device/network settings, stream keys, remote operator controls, distributed ownership and hardware readiness moved under a collapsed Settings section.
- Testing & Diagnostics, Incident Management, Tournament Readiness, and Reports & History moved under a collapsed Advanced Tools section. Live Health remains available outside Advanced.
- Fleet playback monitoring moved behind its own collapsed advanced panel below node cameras.
- Incident Replay and Recovery Drills panel no longer mounted in user interface; the broken 404 link is not exposed. Underlying files and API logic are not deleted.
- Hardware readiness reorganized into separate recording drive and USB topology cards, with input grid and summary metrics.
- Tournament event/ring display names preserve spaces; filesystem-safe recording slugs still use underscores. Existing saved session names are not automatically rewritten.
- Camera control explicitly identifies local recording as independent of YouTube keys. Recording continues to require a configured microphone, because the current capture pipeline records video plus camera audio. A stream key is only required for YouTube output.

## Important
Item 3 in the original bug list did not name the internal-only section. The Incident Replay panel and engineering-level diagnostics have been hidden, but review the interface for any other specific section to remove.

## Verification
- 454/454 existing native .mjs regression tests passed with Node 22 TypeScript strip mode.
- 7/7 v13 focused tests passed.
- Edited TS/TSX files parsed with the TypeScript compiler API without syntax errors.
- Full TypeScript typecheck, Vite build, and browser-based UI tests have not been run in this environment.

## Windows verification
From `C:\Projects\TournamentStreaming` run each command separately:

    npm run typecheck
    npm run build
    npm run test:all

For manual UI validation, confirm: blue primary buttons, cameras above diagnostics, no Incident Replay card, video-only local streaming not being confused with YouTube keys, and session display names containing spaces after Save Session. Ensure a microphone has been paired before recording.
