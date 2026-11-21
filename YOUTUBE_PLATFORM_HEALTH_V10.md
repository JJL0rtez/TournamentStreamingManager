# Cumulative v10: YouTube platform API health

The v10 patch adds a **read-only** YouTube API status panel next to the separate local FFmpeg relay and independent playback observer panels. It checks `liveBroadcasts.list` for lifecycle state and `liveStreams.list` for ingest state and health. It does not transition broadcasts, start/stop streams, change stream keys, or establish that viewers can play video.

## Setup (Node service, not dashboard)

1. Create an OAuth 2.0 client in a Google Cloud project where YouTube Data API v3 is enabled. The Google account must own or have appropriate access to the relevant live broadcasts. Obtain authorization with `https://www.googleapis.com/auth/youtube.readonly` scope and an offline refresh token. The app does **not** provide the OAuth consent/login screen. Configure the following environment variables securely on the Node service:

   * `TSM_YOUTUBE_OAUTH_CLIENT_ID` = OAuth client ID
   * `TSM_YOUTUBE_OAUTH_CLIENT_SECRET` = OAuth client secret
   * `TSM_YOUTUBE_OAUTH_REFRESH_TOKEN` = offline refresh token

2. Set `TSM_YOUTUBE_BROADCASTS_JSON` to an array of up to eight camera/broadcast mappings, for example:

   `[{"cameraId":"ring1","broadcastId":"YOUR_YOUTUBE_BROADCAST_ID"}]`

   The broadcast ID is the YouTube broadcast/video identifier, **not** the stream key or ingest URL. Camera IDs must match the logical camera IDs used in this application. Use the broadcast ID for the correct YouTube channel/account associated with the OAuth credentials. For separate channels, run the platform health service with credentials scoped to the relevant account, or extend the deployment with multiple credential profiles. This release uses **one OAuth identity**.

3. Alternatively for short diagnostics only, provide `TSM_YOUTUBE_OAUTH_ACCESS_TOKEN` (a valid bearer access token) instead of refresh credentials. Such tokens expire and are not suited to an all-day tournament. Restart the Node service after setting your environment. Nothing is stored in the browser.

4. Open the dashboard's **YouTube platform health** panel. Or query `/api/operations/youtube-platform-health` through the authenticated application. The endpoint caches results for 60 seconds; it returns sanitized camera status only. Automatic OAuth refreshes use the fixed `https://oauth2.googleapis.com/token` origin.

## Interpretation

* Broadcast `live` means YouTube's broadcast lifecycle reports live.
* Ingest `active` means YouTube reports receiving data from the bound stream.
* `health: good` or `ok` is an ingest configuration signal, **not** a video freeze, silence, or viewer playback check.
* Missing mappings, incomplete credentials, API errors, broadcasts without bound streams, and missing API status remain unknown/warning, never healthy.
* The independent FFmpeg playback observer and local relay process diagnostics remain separate. A robust production check considers all three.

## Security and operational constraints

* The dashboard receives no access token, refresh token, client secret, stream key, or YouTube RTMPS URL.
* All Google API calls have a fixed origin, deadline, bounded response, and no redirects. No endpoint accepts arbitrary fetch URLs.
* This is read-only, with no automatic camera or broadcast control.
* An expired/revoked refresh token or an account without YouTube live permissions produces unknown state rather than a false positive.
* All YouTube account/API configuration must be completed on your hardware. Without it, the panel intentionally shows not configured.

## Verification

Run `npm run typecheck`, `npm run build`, `npm run test:all`. The new focused test file is `tests/youtube-platform-health.test.mts`.
