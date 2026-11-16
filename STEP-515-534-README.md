# Steps 515-534: Tournament display presets

Extract into C:\Projects\TournamentStreaming after Steps 495-514.

Adds shared preset save/list/load/delete functionality, with a maximum of 50 presets and validation of slide contents. Presets contain billboard slides, their images and themes, display layout, and clock visibility. Presets are stored on the Node host in `data/billboard-presets.json`. Loading a preset updates the live shared billboard and prompts for confirmation. Existing billboard assets are referenced, not duplicated.

Run `npm run typecheck` and `npm run build` and test with two browser sessions. Test saving, loading, deleting, and restarting the backend. The preset UI is part of the billboard editor.

Limitations: presets do not contain camera mappings or YouTube keys. Layout and clock are applied locally on the operator browser, not synchronized to other display browsers. Existing shared billboard synchronization still updates slides within about five seconds. Do not delete image assets referenced by saved presets, as this may break their images.

The ZIP archive was integrity-tested; TypeScript compilation and live browser tests were not performed here.
