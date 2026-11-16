# Steps 575–594: Separate schedule slides and camera rotation controls
Extract over project after Steps 555–574. Backup api.ts and Presentation.tsx before overwriting.
Run `npm run typecheck` and `npm run build`.
Schedule screen: /presentation?mode=schedule; edit with "Edit ring assignment slides". Save publishes to server every connected display polls every four seconds. JSON import/export only backs up slides.
Camera screen: /presentation?mode=cameras; edit with "Camera rotation settings". Master switch, blacklist, dwell time, centre motion threshold and sponsor URLs. Fullscreen hides toolbar and editors.
Storage: data/tournament-displays.json; GET/PUT /api/tournament-displays; revision conflict detection.
Limitations: Existing camera rotation still relies on JPEG preview endpoints and therefore needs active capture. Always-on camera preview on the main dashboard and continuous motion analysis independent of the presentation page are NOT implemented in this batch. Sponsor URLs require browser-playable files. Schedule slides are separate from existing announcement billboard; old preset controls are hidden rather than deleted to avoid disturbing prior state.
