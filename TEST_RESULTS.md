# Unit test results

Executed in this environment on Node v22.16.0:

`node --experimental-strip-types --test tests/*.test.mjs`

The native test files include TypeScript imported directly via Node experimental strip-types; the complete `.mts` suite was **not** run here because local npm dependencies were incomplete.

Result: **433 tests, 417 passing, 16 failing**.

Failures (several assert specific historic source formatting and route placement; they are not automatically runtime defects, nor proven false positives):

- 36 - verification cannot run during command
- 124 - API manual recovery is lease-aware but watchdog remains disabled
- 139 - watchdog does not restart distributed captures
- 141 - status reports effective recovery setting
- 152 - single relay mutation routes are opt-in, bulk remain blocked
- 164 - inspection is read-only and omits secrets
- 166 - restart requires opt in and is operator initiated
- 167 - restart refuses live or untracked relay
- 168 - restart validates owned capture and lease state
- 169 - restart checks output restrictions and port collisions
- 170 - restart uses existing lease and does not stop recording
- 242 - installer adds opt-in, only remote capture commands, and backup
- 260 - bulk route reports per-camera conflicts without aborting already started cameras
- 261 - bulk route releases reservation and busy flag in finally
- 262 - bulk route preserves per-camera outcome response
- 412 - patcher integrates existing YouTube coordination and is idempotent

Next: On your fully installed project run `npm run typecheck`, `npm run build`, `npm run test:all`; then investigate remaining failures before any live tournament use.
