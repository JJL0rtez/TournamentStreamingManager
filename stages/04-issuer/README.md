# TournamentStreaming Event Pass Issuer Bulk

This release adds an operational offline Ed25519 issuer to the event-pass
verification and activation backend delivered in the previous batch.

Functional additions:
- Generate an Ed25519 issuer key pair with no key overwrite.
- Validate event/license IDs and a unique list of 1-64 authorized node IDs.
- Issue signed 10-day event passes for multiple PCs.
- Explicit pass expiry validity window independent of 10-day activation.
- Write signed passes to a new JSON file, refusing overwrite.
- Test cryptographic signature and duplicate-node rejection.
- Include an example claims file.
- Include prior event-pass backend files for a single compatible extract.

ISSUER MACHINE ONLY: never copy the private PEM key into TournamentStreaming,
never commit it to Git. Deploy only the public key to Node machines.

PowerShell commands (single physical line each):
node scripts/event-pass-issuer.mjs keygen issuer-private.pem issuer-public.pem
node scripts/event-pass-issuer.mjs issue examples/event-pass-claims.example.json issuer-private.pem event-pass.json
node --test tests/event-pass-issuer.test.mjs
node --experimental-strip-types --test tests/event-entitlement.test.mjs
npm run typecheck
npm run build

Edit the example claims before issuing real passes. Each capture computer must
be configured with its own TSM_NODE_ID matching an allowedNodeIds entry, and
TSM_LICENSE_PUBLIC_KEY_PEM with the issuer PUBLIC key PEM (newlines escaped
when stored as a single-line environment variable).

Install pass with POST /api/entitlement/install, JSON body from event-pass.json.
Activate explicitly with POST /api/entitlement/activate.
GET /api/entitlement/status reports status.

SECURITY LIMITATIONS:
- This is an offline issuer prototype, not a payment or anti-piracy service.
- No centralized node-seat ledger, revocation, or clock-rollback protection.
- Node IDs are operator-configured strings, not hardware-bound identifiers.
- Activation files are not tamper-proof.
- The existing free-tier guard remains opt-in for compatibility.
- Full project TypeScript build and Windows tests have not been run here.
- This ZIP includes api.ts from the prior event-pass batch. Reconcile local
  modifications before overwriting it.
