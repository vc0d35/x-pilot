/** At most one ping every five seconds: main only needs to know the user was here recently. */
export const ACTIVITY_PING_MS = 5_000;

const EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * Tells main that the user is working in this window, so a scheduled run that would take it over
 * waits for them to stop. Nothing about what they did is sent, and the ping is rate-limited here
 * rather than in main, so a busy page costs one message every five seconds at most.
 */
export function installUserActivityPing(
  doc: Document,
  ping: () => void,
  opts: { intervalMs?: number; now?: () => number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? ACTIVITY_PING_MS;
  const now = opts.now ?? (() => Date.now());
  let last: number | null = null;
  const onEvent = (ev: Event) => {
    // Page script can dispatch these at will; only the user's own hands defer a run.
    if (!ev.isTrusted) return;
    const at = now();
    if (last !== null && at - last < intervalMs) return;
    last = at;
    ping();
  };
  for (const type of EVENTS) doc.addEventListener(type, onEvent, { capture: true, passive: true });
  return () => {
    for (const type of EVENTS) doc.removeEventListener(type, onEvent, true);
  };
}
