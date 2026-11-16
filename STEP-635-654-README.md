TournamentStreaming Steps 635-654: Schedule fullscreen, rotation, table layout and logos

Apply on top of Steps 615-634. Extract the ZIP at the project root, replacing matching files.

1. Fullscreen presentation background forced to pure black and outer outlines/borders removed.
2. Slide rotation timer no longer restarts whenever the server returns a fresh slide array every four seconds. It uses stable slide ID/duration signatures and keeps a live reference to the latest slide list.
3. Schedule table placement supports a row (1-12), column (left/right) and row height (1-3 rows).
4. Add table below inserts into a new row; add table right inserts into the right column of the current row.
5. A single table in a row is centered automatically. Two tables occupy left and right positions.
6. The row-span option supports an asymmetric left tall table beside two stacked right tables (assign left row 1 span 2; right tables row 1 and row 2).
7. Logo editor lists images from the existing server asset library instead of requiring typed URLs.
8. Logo upload uses the existing /api/billboard/assets endpoint, then refreshes the selectable list.
9. Individual logo width, horizontal offset and vertical offset are configurable and persisted to the shared server document.
10. JSON schedule backup includes branding settings.
11. Backend validates/persists table row/column/span and per-logo placement settings.

Run: npm run typecheck
Run: npm run build

Test: Create two slides with short durations (3 and 5 seconds), enter fullscreen, verify the slides rotate while the screen remains black. Test single-table centering and a tall left table with two stacked right tables. Upload a PNG logo and select it from the list, set size and offsets, publish, and open the presentation on another PC.

Known limitations: Layout uses CSS grid and estimated table font sizing; crowded slides can still require manual adjustment. Multiple tables assigned to the same row/column will overlap, so use distinct cells. Uploaded images live on the server and must be accessible to every dashboard. Full app typecheck and browser testing are not available in this environment; TypeScript syntax transpilation passed.
