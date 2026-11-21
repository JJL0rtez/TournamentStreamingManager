# TournamentStreaming: Capture-Safe Windows Restart Interlock

This is a targeted safety release for the previously delivered Windows crash
supervisor. It prevents one dangerous failure mode: the npm/Node launcher exits
but its FFmpeg capture descendants remain running, then a supervisor starts a
second capture manager and risks duplicate streams/recordings.

## What changes

- Before **each automatic restart of the Node role**, inspect the Windows
  process table for remaining FFmpeg processes.
- If **any** FFmpeg process exists, stop automatic restarts and mark the
  supervisor `restart-blocked` with reason and PIDs.
- If the process enumeration fails or produces invalid data, block restarts.
- Dashboard-only supervisor restarts remain unchanged.
- No forced FFmpeg termination, camera disconnection or automatic takeover.
- Exposes a standalone operator check, `check-capture-restart.mjs`.
- Seven automated tests cover safe, blocked and failure cases.

## Install

Extract into the project root, replacing the prior
`scripts/windows/supervisor.mjs` and adding the two new files.

One-line PowerShell commands:

`cd C:\Projects\TournamentStreaming; node --test tests/capture-safety.test.mjs`

`node scripts/windows/check-capture-restart.mjs`

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\supervisor-status.ps1`

## Critical limitations

This is deliberately conservative: **any** ffmpeg.exe running on the Windows
computer prevents an automatic Node restart, even if it belongs to another
application. It does not establish exclusive camera ownership, ensure no other
capture program uses the webcam, or prevent a manual duplicate start. It also
does not verify the Node API port is free or guarantee crash recovery. The
Windows PowerShell process probe and complete application have not been tested
on actual tournament hardware. Do not enable unattended tournament restarts
until a full real-camera failure drill passes.

The supervisor file is based on the last supplied Windows supervisor patch.
Reconcile independent local edits before overwriting it.
