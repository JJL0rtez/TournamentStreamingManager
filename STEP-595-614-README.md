# Steps 595–614: Display repair patch

Apply over Steps 575–594. This is a targeted repair, not a new feature expansion.

- The navigation now offers only Ring assignments display and Camera display, with their respective editors. Legacy billboard, duplicate ring display and separate announcement editor are no longer shown.
- The ring slide editor no longer discards unsaved edits when the server polls every 4 seconds. This was why newly added slides/tables disappeared.
- The camera display starts missing standalone previews via existing POST /api/previews/start using the assigned camera ID and camera name, and samples all eligible cameras via GET /api/previews/:cameraId/frame.
- The rotation samples centre-frame movement for every eligible camera. At each dwell deadline it prefers eligible cameras meeting the threshold, otherwise selects the camera with the highest measured movement among available previews. It does not wait indefinitely for motion.
- The display reports preview errors and available camera count. Camera blacklist and master switch remain in the separate rotation editor.

Limitations: Previews are started when the camera display is opened, not yet by a dedicated server-side always-on monitoring worker. Existing camera preview processes may be affected by USB bandwidth or exclusive device access. Sponsor videos autoplay muted to comply with browser autoplay restrictions. Camera display still uses sampled JPEG frames, not continuous full-rate video.

Run `npm run typecheck` and `npm run build`. Verify with physical cameras, including preview startup while no stream is running. Back up the current files before extracting.
