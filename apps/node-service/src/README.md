# Live preview milestone

Copy `api.ts`, `PreviewProcessManager.ts`, `PreviewFfmpeg.ts`, and `PreviewSessionManager.ts` to `apps/node-service/src/`. Existing files of those names are replaced. `camera-capture.ts` remains unchanged.

## Dashboard integration

The existing dashboard already has `previewCameraIds`, preview start/stop API calls, and 200ms `managedPreviewFrame` updates **only when recording**. To show standalone previews, adjust the existing `.camera-preview` content:

```tsx
{(managedCapture?.previewAvailable || previewCameraIds.includes(camera.id)) ? (
  <img
    src={previewCameraIds.includes(camera.id)
      ? `/api/previews/${encodeURIComponent(camera.id)}/frame?t=${managedPreviewFrame}`
      : `/api/captures/${encodeURIComponent(camera.id)}/frame?t=${managedPreviewFrame}`}
    alt={`${camera.name} live preview`}
    className={`camera-preview-video ${identifyingCameraId === camera.id ? "camera-preview-identifying" : ""}`}
  />
) : managedCapture ? (
  <div className="camera-preview-placeholder">Waiting for preview...</div>
) : (
  <div className="camera-preview-placeholder">Preview inactive</div>
)}
```

Change the existing 200ms frame-refresh effect's guard and dependency from `managedCaptures.length` to `managedCaptures.length + previewCameraIds.length`:

```tsx
useEffect(() => {
  if (managedCaptures.length === 0 && previewCameraIds.length === 0) return;
  const interval = window.setInterval(() => {
    setManagedPreviewFrame((current) => current + 1);
  }, 200);
  return () => window.clearInterval(interval);
}, [managedCaptures.length, previewCameraIds.length]);
```

Note: When starting preview, the backend waits for the first frame (up to 12 seconds). The frontend's existing button only switches to Stop Preview after that succeeds. While waiting, the UI may still show Start Preview.

## Compile

`cd C:\Projects\TournamentStreaming; npx tsc --noEmit --project tsconfig.json --jsx react-jsx --allowImportingTsExtensions`

`cd C:\Projects\TournamentStreaming; npx tsc --noEmit --project apps/dashboard/tsconfig.app.json`

## Test

Start Preview on each EMEET, check both images. Stop one and confirm the other continues. Start recording while preview is active and confirm it switches to the recording frame feed. Stop recording and confirm standalone preview resumes. Stop Preview and verify no standalone FFmpeg process remains. Test unplugged camera / FFmpeg failure and confirm API reports an error.

## Limitations

The old `/api/capture/test`, `/api/preview/*`, and `/api/recordings/*` endpoints are legacy and not coordinated with the new preview ownership. Avoid using them concurrently. `stop-all` does not automatically resume standalone previews. USB bandwidth may limit simultaneous 1280x720@30 inputs. Test on Windows hardware before production.
