# Steps 535–554: Tournament display bundle import/export

Extract into C:\Projects\TournamentStreaming after applying Steps 515–534. Only `apps/dashboard/src/Presentation.tsx` is replaced.

Features: Export current session ring/camera/microphone assignments and shared billboard slides in a JSON bundle. Import with file size and structure checks, preview event/ring/slide counts, explicit confirmation, server-side session validation, and shared billboard revision checking. Existing server refuses session changes while captures or YouTube relays are running. Layout and clock preferences are browser-local.

Important limitations: The session and billboard are updated in two API calls, not atomically. If the second fails, the session may already have changed; an error is shown. Export does not include YouTube stream keys, uploaded image file contents, or recording settings. Uploaded image references require the same server's asset library. Always review camera/microphone assignments after importing.

Commands:
`npm run typecheck`
`npm run build`

Open `/presentation?mode=billboard`, enable the editor, export a bundle, select that JSON in Import, inspect the preview, and apply only with all streams stopped.
