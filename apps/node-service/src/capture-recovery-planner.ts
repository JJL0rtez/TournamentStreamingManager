/** Bounded, per-camera retry budget. No timers or device operations in this module. */
export function recoveryEnabled(): boolean {
  return process.env.TOURNAMENT_CAPTURE_AUTO_RECOVER === "1";
}

export class CaptureRecoveryPlanner {
  private attempts = new Map<string, { count: number; windowStart: number }>();
  constructor(
    privateMaxAttempts = 3, privateWindowMs = 10 * 60_000,
    privateBaseDelayMs = 2_000, privateMaxDelayMs = 30_000
  ) {
    this.maxAttempts = privateMaxAttempts;
    this.windowMs = privateWindowMs;
    this.baseDelayMs = privateBaseDelayMs;
    this.maxDelayMs = privateMaxDelayMs;
  }
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  nextDelay(cameraId: string, now: number): number | null {
    const current = this.attempts.get(cameraId);
    const count = current && now - current.windowStart < this.windowMs ? current.count : 0;
    if (count >= this.maxAttempts) return null;
    this.attempts.set(cameraId, { count: count + 1, windowStart: count ? current!.windowStart : now });
    return Math.min(this.baseDelayMs * 2 ** count, this.maxDelayMs);
  }
  clear(cameraId: string): void { this.attempts.delete(cameraId); }
  clearAll(): void { this.attempts.clear(); }
  snapshot(): Array<{ cameraId: string; attempts: number }> {
    return [...this.attempts].map(([cameraId, state]) => ({ cameraId, attempts: state.count }));
  }
}
