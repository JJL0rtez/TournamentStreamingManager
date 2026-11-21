# TournamentStreaming: Signed Event Pass Core

This is an integrated backend event-pass foundation, NOT a completed payment or tamper-resistant commercial licensing system.

Features:
1. Ed25519 offline signature verification; private signing key is NOT in app.
2. Strict schema, event ID, license ID, authorized node list and max node count validation.
3. Explicit pass installation without activation.
4. Explicit activation starts the 10-day clock.
5. Activation persisted across service restarts.
6. Expiry checks at output-start time; existing FFmpeg processes are not terminated.
7. Node-bound entitlement checks using the configured TSM_NODE_ID.
8. All five existing output-start guards respect active event entitlements when free enforcement is enabled.
9. Read-only GET /api/entitlement/status.
10. POST /api/entitlement/install accepts a signed JSON pass envelope.
11. POST /api/entitlement/activate explicitly starts the pass.
12. Tests for signature tampering, expiry, node authorization, persistence and activation.

Configuration on each Node service:
- TSM_NODE_ID: stable, unique node ID provided to the license issuer.
- TSM_LICENSE_PUBLIC_KEY_PEM: Ed25519 issuer public key PEM, with literal `\\n` supported.
- TSM_ENFORCE_FREE_PRODUCTION=1: enable the existing free clean-output limit. Without this opt-in, legacy behavior remains unlimited.

Install the zip into the project root after previous bulk patches. The included api.ts is based on the last USB-topology patch. Reconcile independent changes first.

Run:
node --experimental-strip-types --test tests/event-entitlement.test.mjs
npm run typecheck
npm run build

LIMITATIONS: no issuer/admin pass-generation workflow, payment processing, centralized multi-node seat allocation, reliable offline clock tamper protection, hardware fingerprint binding, anti-rollback secure storage or cryptographic activation receipts. A user with filesystem control can reset activation. Do not sell passes until these are resolved. No live streams are terminated on expiry. Full Windows runtime integration is unverified.
