/** A production YouTube relay must never stream-copy diagnostic video. */
export function productionRelayAllowed(capture: { outputMode?: string } | null | undefined): boolean {
  return Boolean(capture && capture.outputMode !== 'diagnostic');
}

/** A bulk relay must re-check each camera independently, even after bulk authorization. */
export function productionRelayError(capture: { outputMode?: string } | null | undefined): string | null {
  if (!capture) return 'Camera capture is unavailable.';
  if (!productionRelayAllowed(capture)) return 'Diagnostic capture cannot enter the production YouTube relay.';
  return null;
}
