TournamentStreaming steps 655-674: branding and live camera transport update

Apply after steps 635-654, at the project root. Back up the replaced files, especially apps/node-service/src/api.ts. Keep the tournament-displays.ts from steps 635-654.

Changes:
- Title-left logo now sits directly beside the centred title instead of at the screen's far left. Upper-left logos remain at the far left.
- Clock restored to the right side of the schedule header, updates every second, obeys the existing Clock toggle.
- Default gold text colour is now vivid #ffcc00. Existing custom title colours are respected; change an existing gold line in the editor if needed.
- New image uploads retain their original filename in a .name sidecar in data/billboard-assets. The logo selector displays that filename rather than a UUID. Existing uploads with no sidecar retain their stored name.
- Camera display uses a continuous multipart MJPEG endpoint /api/display-live/:cameraId instead of replacing a still image every 1.5 seconds.
- The endpoint reuses frames from a running camera capture, falling back to the existing preview process when no capture is running. It does not attempt to open a second camera handle.
- Motion analysis continues sampling the existing preview frames separately from public playback.

Important: Multipart MJPEG is a continuous browser-compatible live feed, but the actual frame rate and resolution depend on getFrame() from the existing capture or preview process. This is not yet a native 1080p30 H.264/WebRTC playback pipeline. For production full-resolution playback, implement an encoded stream fan-out from the existing capture process rather than opening another DirectShow capture.

Check:
 npm run typecheck
 npm run build

Verify schedule fullscreen branding/clock, upload a logo and see its original name, and open camera display while a capture is running. If a live camera is not available, inspect /api/display-live/<cameraId> and /api/previews/<cameraId>/frame.

TypeScript syntax transpilation passed for all modified .ts/.tsx files. Full typechecking, build, and hardware tests are pending.
