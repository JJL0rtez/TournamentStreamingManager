# TournamentStreaming: Windows Recovery and Startup Bulk

This release builds on the prior Windows deployment scripts. It adds a crash
supervisor, operator startup tasks, status and support-bundle workflows.

## Implemented

1. Node.js supervisor for the existing `npm run dev:node` launcher.
2. Optional second supervisor for `npm run dev` dashboard launcher.
3. Restart on unexpected launcher exit, including clean exit.
4. Exponential restart delay (2 to 120 seconds).
5. Reset restart delay after 60 seconds of stable runtime.
6. Persist supervisor PID, child PID, crash count and timestamps.
7. Separate supervisor logs and capped rotation.
8. Optional loopback-only HTTP health checks, reporting without restart.
9. PowerShell launcher with duplicate supervisor detection.
10. PowerShell status for both roles.
11. PowerShell guarded stop of supervisor process.
12. Optional Scheduled Task registration at user logon.
13. Removal of Scheduled Task.
14. Minimal sanitized diagnostic support ZIP excluding credentials and recordings.
15. Five executable tests of backoff, shutdown and config validation.
16. Reuses previous Windows install, preflight, backup and log scripts.

## Install and run

Extract into the root of `C:\Projects\TournamentStreaming`.
Run commands as single lines in PowerShell:

`cd C:\Projects\TournamentStreaming; node --test tests/supervisor.test.mjs`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\preflight.ps1 -RecordingDirectory "D:\Recordings" -MinFreeGiB 50`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\supervisor-start.ps1 -Role both`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\supervisor-status.ps1`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\register-startup.ps1 -Role both`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\support-bundle.ps1`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\register-startup.ps1 -Role both -Remove`

## Critical limitations

- **Do not enable automatic supervisor restarts during a live event until tested**
  on Windows with your exact camera/FFmpeg setup. `npm` spawns descendants, so
  a launcher can exit while FFmpeg descendants remain alive. An automatic
  restart could create duplicate streams or capture processes.
- This is NOT Windows Service/SCM integration, an MSI or a production installer.
- Scheduled Task runs at current user logon, not at boot before login.
- Supervisor shutdown stops the supervisor, not all descendants. The capture
  manager remains responsible for safe camera/FFmpeg shutdown.
- Supervisor does not reconnect cameras or recover a broken YouTube session.
- Health checks are observational and do not stop recording.
- No unattended live tournament test or Windows PowerShell execution was
  possible in the container. Only Node logic tests and ZIP integrity passed.
- Recording path is an example, not an assumed drive letter.
