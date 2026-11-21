# v14: Stream and recording controls, recording location, operator cleanup

This archive supersedes cumulative patches v1 to v13 when extracted into the project root. It contains changed files relative to the original TournamentStreaming(4).zip, not a complete standalone copy of the project.

## Operator interface changes
- Ordinary camera cards do not expose recording-mode selection, diagnostic-watermark setup, or a camera-label input.
- Camera labels use the ring assignment from Tournament Session first.
- Record is the recording button, independent of a YouTube stream key.
- Start Stream can start a no-recording capture automatically when no capture is active; stopping that stream stops only its temporary stream-only capture. Start Assigned YouTube Streams now uses this same independent behavior, rather than requiring all recordings to be active.
- The Save key button changes to disabled Saved once a profile exists. Forget key is next to it.
- Removed bulk stream-key setup and the per-ring checklist from the GUI. Also removed browser-only launch authorization dependent on that checklist. The release acceptance CLI remains in place.
- Local recording folder can be selected from a folder browser or typed, saved and reused across restarts. Existing recordings are never relocated.

## Important behavior / limitations
- A live capture's FFmpeg output topology is fixed at startup. For safety, turning recording on or off during an active YouTube stream is blocked rather than silently restarting the camera and interrupting its livestream. Starting either independently from idle works, and starting a stream while already recording works.
- Recording location is a server filesystem path, not a browser upload folder. The selection must be made on the streaming computer using Settings > Hardware Readiness > Recording Drive. Changing location is blocked while capture/relay processes or storage benchmarks are active.
- Saved path is stored in `.tsm-recording-location.json` at the project root. Existing files are not moved. Ensure the selected drive is connected and writable before recording. The location setting is local to each capture PC.
- Independent stream startup still requires a microphone, because the current capture input combines the camera with its selected audio device.
- This feature changes production source behavior but does not assert that live-camera performance was tested here.

## Validation
- 468 of 468 native JavaScript tests passed using Node 22 experimental TypeScript stripping.
- TypeScript/TSX parse/transpile checks passed for edited source files. Full project `typecheck`, Vite build, and physical streaming tests require the user's Windows machine.

## Windows verification (single physical line each)
`npm run typecheck`
`npm run build`
`npm run test:all`
