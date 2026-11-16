# Steps 285–294: Capture lifecycle hardening

Extract the patch over the project root. No existing user configuration, recordings, or dashboard files are included.

- 285–287: The capture sender and YouTube receiver use the same logical camera ID for UDP ports. Physical DirectShow names no longer select the relay port when cameraId is supplied.
- 288–292: Reject duplicate active/pending physical cameras and microphones; avoid opening the same device twice.
- 293: Shared capture stop is idempotent and waits for FFmpeg close, with termination fallback.
- 294: Capture manager and relay idle shutdown remains safe.

Additional changes: disable overwrite of existing MKV segments with `-n`, improve early FFmpeg exit diagnostics, and clean up failed capture starts.

## Verify

`npm run check:baseline`

`npm run check:integration`

## Hardware validation (manual, not covered by unit tests)

1. Attach a USB camera and microphone, choose the correct devices, and start local recording.
2. Confirm preview frames appear and the MKV segment grows. Stop and check the file opens in VLC.
3. Start a private/unlisted YouTube test stream and confirm both video and audio on the viewer side.
4. Stop streaming without stopping recording, then stop recording; verify no orphan FFmpeg processes.
5. Repeat with two different USB cameras. Confirm both operate independently.

**Important:** These regression tests do not prove live capture or YouTube transmission. Test on Windows with your actual devices before marking hardware operation verified.
