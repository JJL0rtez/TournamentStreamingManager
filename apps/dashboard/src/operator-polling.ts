/** Schedule the next read only after the previous one settles. Hidden tabs
 * slow background reads without affecting live capture or mutation commands. */
export function startPolling(task: () => void | Promise<void>, intervalMs: number, hiddenIntervalMs = Math.max(intervalMs, 60000)): () => void {
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visibility = typeof document === "undefined" ? undefined : document;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    if (!stopped) timer = setTimeout(() => { void run(); }, visibility?.hidden ? hiddenIntervalMs : intervalMs);
  };
  async function run() {
    if (stopped || pending) return;
    clear(); pending = true;
    try { await task(); } catch { /* Callers own error display; continue polling. */ }
    finally { pending = false; schedule(); }
  }
  const visible = () => { if (!visibility?.hidden) void run(); else if (!pending) { clear(); schedule(); } };
  visibility?.addEventListener("visibilitychange", visible);
  void run();
  return () => { stopped = true; clear(); visibility?.removeEventListener("visibilitychange", visible); };
}
