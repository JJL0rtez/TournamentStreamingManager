Milestone 77: Guided troubleshooting history and comparison

Extract into C:\Projects\TournamentStreaming and overwrite matching files.

Adds browser-local persistence for up to 30 operator-guided troubleshooting
worksheets. Save, load, delete, import/export history JSON, and compare two
worksheets step-by-step to evaluate operator-reported changes. Each saved entry
includes camera/ring, operator, fix/change tested, outcome summary and step notes.

No automatic test execution or camera changes. Results are manual and do not
prove a fix. Browser-local storage does not synchronize across computers; export
regularly. All prior source changes are included. Full-project compilation and
Windows hardware testing remain pending.

Milestone 78: Browser-local troubleshooting effectiveness statistics compare consecutive saved worksheets for the same camera by operator-reported final verification results. Categories are inferred from the later worksheet change description; export JSON. No causal claims or automatic reliability measurement.

Milestone 79: Camera reliability overview
- GET /api/camera-health/reliability-summary combines bounded recording journal outcomes and sampled USB connection transitions by camera.
- Dashboard adds a manual-refresh per-camera summary and JSON export.
- Does not equate sampled observations with continuous uptime or infer causes.
- Browser-local guided troubleshooting worksheets remain in the existing troubleshooting effectiveness panel, not in the server summary.

Milestone 80: Consolidated tournament readiness dashboard
- Added read-only dashboard combining current assignment readiness, disk free space, retained camera/USB reliability events, active recording health, relay count, and current CPU/GPU usage.
- Refresh on demand, export a timestamped JSON snapshot, and distinguish pass/warning/blocker/unknown.
- This does not replace preflight, active stream playback verification, or a live stress test.

Milestone 81: Per-ring pre-tournament operator checklist
- Manual camera framing/position, microphone listening, local recording quality, external YouTube playback, and recovery/backup confirmation for every assigned ring.
- Operator notes, completion progress, timestamped sign-off, and JSON export.
- Browser-local persistence per node/event; assignment changes invalidate the sign-off and require checklist reset.
- Existing hardware readiness report and its separate global checklist remain available.
- Does not perform automatic tests or prove live stream quality. Full-project compilation and Windows camera testing remain pending.

Milestone 82: Tournament-day incident impact and recovery tracking
- Existing browser-local operator incident log extended with interruption/degraded/no-impact classification.
- Open/resolved/interrupted counts, average operator-reported time to resolution, and incident status filter.
- Resolved duration shown per incident and exported to CSV; JSON includes impact and resolution metadata.
- Existing auto-created critical alert incidents are classified as interrupted by default, and can be reviewed manually.
- Previous entries without impact remain valid and display Unknown.
- This is browser-local, not synchronized across nodes or devices. Resolution durations are not independently measured stream downtime.
- This archive preserves the same source subset as the preceding milestone; full-project compilation and hardware tests are pending.

Milestone 83: Browser-local tournament incident analytics
- Incident analytics panel next to the operator incident log.
- Filter incidents by recent time period (1 hour to 30 days).
- Per-ring incident counts, unresolved counts, interruption counts and latest incident.
- Incident category frequency and mean operator closure duration.
- Download an event/node scoped JSON analytics report.
- Read-only aggregation of existing browser-local incident records; no capture settings are changed.
- Incident records are capped at 300 in the existing log; analytics cannot infer actual stream downtime.
- Compilation and Windows hardware tests remain outstanding.

Milestone 84: Time-based tournament incident trends
- Browser-local incident trends panel with 6h, 24h, 72h, 7d, and 30d analysis windows.
- Configurable 1h, 6h, 12h, or 24h time buckets; incident count bars and interruption markers.
- Interval detail table and equal-duration first-half versus second-half interruption counts.
- Timestamped JSON trend export with explicit coverage and data-quality limitations.
- Counts are operator-reported and do not measure downtime or prove improved reliability.
- Source subset only; compilation and Windows hardware validation remain pending.

Milestone 85: Incident heatmap by ring and local time of day
- Adds an incident heatmap to the tournament dashboard, grouping browser-local incidents by ring and local hour (00-23).
- Select 24, 72, 168, or 720 hours and optionally show only incidents marked as service interruptions.
- Cell intensity scales to the largest count in the current selection; hover for count and interruption details.
- Export the aggregated report as JSON, including the local time zone and data limitations.
- The heatmap uses the same browser-local incident records as the incident log, capped at 300 records.
- This source subset has not undergone full-project compilation or Windows camera hardware testing.

Milestone 86: Post-tournament technical report
- New event-scoped dashboard report combines browser incident counts, recording outcomes by camera,
  node-wide USB disconnect history, and browser-local troubleshooting worksheet summaries.
- Per-ring incident and interruption counts, operator-reported average closure time, and unresolved counts.
- JSON export includes generated timestamp, event/node identifiers, data scope, and explicit limitations.
- Node-wide USB history and unscoped worksheets are clearly labelled, not misrepresented as event-only.
- Existing endpoints are reused. No recording settings are modified.
- This archive remains a cumulative source subset, not a complete verified standalone project.
- Full compilation and Windows hardware tests have not been run.

Milestone 87: Tournament-to-tournament reliability comparisons
- Save a snapshot of the existing post-tournament technical report for each event.
- Compare two browser-local snapshots: incident counts, interruptions, unresolved cases, recording
  sessions and failures, failure percentages, and operator-reported average closure duration.
- Show node-wide USB observations separately with explicit non-event-specific caveat.
- Export comparisons as JSON; retain up to 30 snapshots, one per node/event.
- Snapshot saving is manual, browser-local, and does not sync between operator devices.
- The existing recording journal is capped at 200 sessions, so historical comparisons may be incomplete.
- Source subset only; full-project compilation and Windows camera tests remain pending.

Milestone 88: Multi-tournament reliability trends
- Added browser-side multi-event trends panel using saved post-tournament comparison snapshots.
- Filter by capture node and chart recording failure rate, reported interruptions, incident count, or operator closure time.
- Exact values table and JSON export; missing denominators/closure values show N/A.
- Uses existing 30-snapshot browser-local retention. No new server endpoint.
- Snapshots are sorted by report generation timestamp, which may differ from event date.
- Event duration, camera count, and journal retention limit comparisons; USB history is excluded from trends.
- Full-project compilation and hardware testing remain pending.

Milestone 89: Individual camera reliability trends
- Tournament report archive now offers node-scoped camera selection and an SVG failure-rate chart.
- Per-event table includes sessions, failures, warnings, and ring label.
- Exports selected camera's event series as CSV or JSON.
- Missing camera entries and zero-session events remain unavailable, not zero failures.
- Browser-local reports remain capped at 15. No backend changes.
- Full project build and Windows camera testing not yet performed.

Milestone 90: Operator-confirmed physical camera identity associations
- In the tournament report archive, assign a stable physical label to each historical
  node-scoped camera device ID. Reuse the exact same label for confirmed re-enumerations.
- Individual camera reliability trends group device IDs sharing the same confirmed label
  on the same capture node; without a label they remain separate.
- Export associations as JSON. Labels persist in browser localStorage, not on the node.
- Does not infer USB serial numbers or automatically prove hardware identity.
- Archives with multiple IDs for the same camera in one event use the first matching row;
  investigate those reports separately. Avoid using ring names as hardware labels.
- This archive is a cumulative source subset, not a verified standalone build.
- Full compilation and Windows hardware testing remain pending.

Milestone 91: Windows USB hardware fingerprint candidates
- Read-only USB PnP diagnostics now report vendor/product IDs, Windows container IDs, and
  conservative serial-like instance suffix candidates when available.
- Dashboard displays identity evidence and possible previous matches after a second inventory.
- Export hardware inventory as JSON for manual camera identity verification.
- No automatic linking: many identical webcams have no unique serial, composite interfaces
  and port-generated instance IDs can mislead, and Windows container IDs may change.
- Windows PowerShell/USB hardware validation and full-project compilation remain pending.

Milestone 92: Persistent USB hardware fingerprint history and confirmed matching
- USB topology inventory saves up to 25 successful Windows snapshots per capture node in browser local storage.
- Compares fresh PnP identifiers against saved snapshots for possible serial-candidate or container-ID matches.
- Operator must enter an exact recording-report camera ID and unique physical label to confirm a link.
- Confirmed associations use the existing browser-local physical camera identity mapping. Refresh report archive to see changes.
- Exports saved fingerprint history and supports explicit history clearing. No automatic identity merges.
- USB PnP instance IDs, container IDs and serial-like suffixes are not authenticated permanent serial numbers.

Milestone 93: Physical camera equipment inventory and maintenance history
- Browser-local equipment records per capture node with unique physical camera labels.
- Model, manually verified serial, purchase date, warranty end date, and notes.
- Timestamped maintenance actions with operator notes, removal, and capped history.
- JSON export for backups; inventory is not synchronized with other browsers or hardware.
- Previous milestone files included as a cumulative available source subset, not a standalone build.
- Full-project compilation and Windows hardware testing remain pending.

Milestone 94: Recurring equipment maintenance scheduling
- Add per-camera recurring maintenance tasks with configurable intervals (1-3650 days) and first due dates.
- Dashboard lists all scheduled tasks, overdue and due-today counts, and upcoming checks.
- Completing a task writes a timestamped maintenance log entry and schedules its next occurrence.
- Operators can remove schedules without deleting maintenance history.
- Browser-local data only; reminders appear when dashboard is open, not as background notifications.
- Source subset only. Full compilation and hardware validation remain pending.

Milestone 95: Equipment maintenance in consolidated readiness
- Refresh consolidated readiness now reads the current node's browser-local equipment inventory and scheduled inspections.
- Overdue or due-today tasks generate a warning, with affected equipment and task details.
- No registered assets, no schedules, malformed dates, or inaccessible storage yield UNKNOWN, never PASS.
- A PASS means only that recorded maintenance schedules have no due or overdue tasks; it does not certify unregistered cameras or hardware health.
- Completing scheduled maintenance in Camera equipment inventory is reflected on the next readiness refresh.
- Report JSON export includes the maintenance check. Browser-local records do not synchronize between operators or PCs.
- Full-project compilation and Windows hardware testing remain pending. This is a cumulative available source subset, not a verified standalone application.
