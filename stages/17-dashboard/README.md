# TournamentStreaming dashboard crash repair and integration audit

This patch fixes `App.tsx:3372 Uncaught ReferenceError: useCallback is not defined` without overwriting your dashboard. It also includes the previous remote capture control installer and a repository integration inventory.

## Apply on Windows (each command is one physical line)

1. Commit or back up your current work, then extract this ZIP into `C:\Projects\TournamentStreaming`.
2. Repair missing React hook imports: `node scripts/integration/repair-dashboard.mjs`
3. If remote controls have NOT been enabled, apply them: `node scripts/integration/enable-remote-capture-controls.mjs`
4. Check imports: `node scripts/integration/repair-dashboard.mjs --check`
5. Run regression tests: `node --test tests/dashboard-repair.test.mjs`
6. Audit presence of previous bulk integration: `node scripts/integration/audit-patches.mjs`
7. Run project checks: `npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run build`

For one-command repair plus remote opt-in installation, use `node scripts/integration/repair-and-enable-remote.mjs` instead of steps 2 and 3. The remote installer is idempotent and will not replace an already-enabled dashboard.

## What is and isn't tested

The seven included Node tests verify import repair, idempotence, backup, non-destructive check mode and warnings. The full application typecheck/build must be run on your current repository because your local patches and installed dependencies are not accessible here. The inventory script reports which earlier patch components exist; missing components are not automatically installed. Do not mistake a passing inventory for complete integration.

## Important safety notes

- The remote opt-in checkbox is a UI safeguard, not authentication. The Node backend must enforce a strict route allowlist and shared-secret authentication.
- A timed-out remote start/stop may have succeeded; do not blindly retry.
- Do not enable unattended recovery or stream startup during a live event until Windows hardware testing confirms capture ownership and duplicate-stream protection.
- Every file changed by the installers receives a timestamped backup. No existing `App.tsx` is included in this ZIP.
