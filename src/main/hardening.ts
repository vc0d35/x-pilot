export interface HardenableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-attach-webview', listener: (e: { preventDefault(): void }) => void): unknown;
}

/**
 * The baseline every WebContents gets the moment it is created: no new windows, no <webview>, and
 * the navigation policy the caller supplies. Attaching the policy here rather than per site is what
 * covers descendants nobody wired up by hand — grandchild popups, the PDF export window — because
 * `web-contents-created` fires for all of them. Views that need something narrower (a hidden view
 * that must open nothing at all) re-install their own handler afterwards, which replaces this one.
 */
export function hardenWebContents<T extends HardenableContents>(contents: T, attachPolicy?: (contents: T) => void): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
  attachPolicy?.(contents);
}

export interface CrashableContents {
  on(event: 'render-process-gone', listener: (e: unknown, details: { reason: string }) => void): unknown;
  isDestroyed(): boolean;
  reload(): void;
}

/** A killed or cleanly exited renderer is a teardown we asked for, not a crash to recover from. */
const NOT_A_CRASH = new Set(['killed', 'clean-exit']);

/**
 * Reloads a renderer that died, but at most `maxReloads` times per `windowMs`: a page that crashes
 * its renderer on purpose would otherwise get an unbounded reload loop back to the attacker URL.
 */
export function reviveOnCrash(
  contents: CrashableContents,
  what: string,
  opts: { maxReloads?: number; windowMs?: number; now?: () => number; log?: (message: string) => void } = {},
): void {
  const maxReloads = opts.maxReloads ?? 3;
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  let reloads: number[] = [];
  contents.on('render-process-gone', (_e, details) => {
    if (NOT_A_CRASH.has(details.reason)) {
      log(`[xpilot] ${what} renderer gone (${details.reason}); not reloading`);
      return;
    }
    const t = now();
    reloads = reloads.filter((x) => t - x < windowMs);
    if (reloads.length >= maxReloads) {
      log(`[xpilot] ${what} renderer gone (${details.reason}); already reloaded ${maxReloads} times in ${windowMs} ms, leaving it down`);
      return;
    }
    reloads.push(t);
    log(`[xpilot] ${what} renderer gone (${details.reason}); reloading`);
    if (!contents.isDestroyed()) contents.reload();
  });
}
