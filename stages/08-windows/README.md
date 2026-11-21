# TournamentStreaming: Windows Deployment Operations Bulk

This batch adds a Windows development-deployment toolkit for the existing
TournamentStreaming Node/React monorepo. It does not replace the application,
create an EXE/MSI, or claim to be a production Windows installer.

## Included

1. `scripts/windows/install.ps1`: checks Node 22+, npm and FFmpeg; runs `npm ci`, typecheck and dashboard build, failing on errors. Use `-SkipNpmInstall` if you have no lockfile, then install dependencies manually.
2. `scripts/windows/preflight.ps1`: checks Node, npm, FFmpeg and FFprobe, optional recording directory and minimum free space. Writes `.tsm-runtime/preflight.json`.
3. `scripts/windows/start.ps1`: starts Node and/or dashboard dev scripts with separate stdout/stderr logs and PID state.
4. `scripts/windows/status.ps1`: checks whether launchers are still alive.
5. `scripts/windows/stop.ps1`: stops only a launcher whose PID and creation time match the recorded state. It does not forcibly kill child FFmpeg processes.
6. `scripts/windows/logs.ps1`: reads recent logs.
7. `scripts/windows/backup.ps1`: archives known config/entitlement directories and `.env`, if present, without including recordings. Treat the archive as secret.
8. Shared root validation and process ownership logic.
9. Six static regression checks.

## Single-line PowerShell commands

From `C:\Projects\TournamentStreaming`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\preflight.ps1 -RecordingDirectory "D:\Recordings" -MinFreeGiB 50
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1 -Role both
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\logs.ps1 -Role node -Tail 100
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop.ps1 -Role both
node --test tests/windows-deployment.test.mjs
```

Change `D:\Recordings` to the actual 8 TB recording-drive directory.

## Important limitations

- These scripts launch the existing development servers, not a packaged production service.
- PowerShell scripts were not executed on Windows in the build environment; only source-level checks ran.
- The stop script stops the managed launcher, but npm may spawn additional Node children. This is not a verified complete process-tree shutdown. Do not use it to stop a live event.
- No firewall changes, admin privileges, auto-update, reboot recovery or Windows service are configured.
- A dedicated 8 TB drive still needs sustained-write and stability testing using the earlier storage readiness subsystem.
- Keep licensing private keys off all capture computers. Backups can contain secrets.
