# Global notifications integrated with current uploaded app

Source: TournamentStreaming - Copy(3).zip, dashboard App.tsx (8,048 lines).

Replace these three files in C:\Projects\TournamentStreaming\apps\dashboard\src\:
- App.tsx
- GlobalNotifications.tsx
- GlobalNotifications.css

Changes:
- Global notification toolbar and sticky alert banner mounted at root.
- Existing per-node `operationsAlerts` forwarded to global UI without creating new polling or duplicating warning logic.
- Offline nodes also generate critical global notifications, even when their dashboard is unmounted.
- Existing OperationsAlertHistory and other dashboard functionality remain unchanged.
- Acknowledgement is browser-local and does not resolve an active fault.

Run `npm run typecheck` and `npm run build` from project root. Test with a disconnected camera and an offline node.

Validation: TypeScript syntax transpilation passed. Full typecheck, build, and hardware/browser tests not executed here.
