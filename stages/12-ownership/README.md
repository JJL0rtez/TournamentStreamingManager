# TournamentStreaming: Capture Ownership & Recovery Safety Batch

This is an **integration foundation**, not a complete implementation of distributed capture leases.

Features:
1. Windows process identity reader (PID, parent, command line, creation timestamp).
2. Registry format for capture manager-owned FFmpeg processes.
3. Persisted registry with atomic replacement.
4. Detection of PID reuse and mismatched command identity.
5. Detection of unowned FFmpeg processes.
6. Fail-closed handling of stale or ambiguous process identity.
7. Recovery audit command with JSON output and exit code 2 when unsafe.
8. Supervisor uses BOTH the prior conservative FFmpeg process interlock and new ownership report before restarting Node.
9. Local atomic per-ring claim creation, using exclusive file creation.
10. Local claim conflict reporting.
11. Claim release restricted to the matching session and node.
12. Eight automated regression tests.

**Important limitations**:
- The capture manager does not yet write the ownership registry. Until that is integrated, the existing all-FFmpeg conservative interlock remains the controlling safety check.
- Local claim files are NOT shared distributed leases. They cannot prevent two different PCs from streaming the same ring.
- No automatic killing, adopting, or restarting of FFmpeg processes is attempted.
- No auto-claiming at stream start yet. These modules must be integrated with capture start/stop before they enforce duplicate-stream prevention.
- On Windows, the process inspection needs live validation. No Windows host or real cameras were available in this environment.
- The supervisor is based on the previous recovery patch and must be reconciled with independent local edits.

Run:
`node --test tests/recovery-ownership.test.mjs`
`node scripts/windows/recovery-audit.mjs`

The audit command returns a nonzero code on Linux because Windows inspection is unavailable, as intended.

Do not enable unattended live-tournament recovery until capture ownership is integrated and verified with real cameras.
