TournamentStreaming Steps 615-634: ring assignment branding and clean camera output

Apply after steps 595-614. Overwrite matching files in C:\Projects\TournamentStreaming.

Changes:
- Public ring assignments no longer expose internal tournament/session filename.
- Shared, editable multiline title with per-line colours, default white/gold.
- Configurable top-left logos and logos on either side of title (HTTPS or existing uploaded image URLs).
- No visible slide title or smaller table heading; tables display ring names only.
- Two table columns, grey striped backgrounds, white text, centered enlarged ring headers.
- Font size automatically adjusted based on row count and approximate longest row width.
- Camera screen hides ring name and motion/preview diagnostic label; video fits without stretching.
- Slide editor add buttons explicitly mark drafts dirty to avoid poll reset.
- Server persists shared branding alongside slide document.

Commands:
cd C:\Projects\TournamentStreaming; npm run typecheck
npm run build

Limitations: sizing is heuristic rather than measured pixel-perfect fitting; camera frames remain JPEG snapshots rather than live video. Logo URLs must be hosted HTTPS or uploaded to existing image library.
