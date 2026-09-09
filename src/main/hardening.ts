import { extname, resolve, sep } from 'node:path';

/**
 * The sidebar is served from a privileged custom scheme instead of `file:` inside the asar, so the
 * packaged build can ship with the `grantFileProtocolExtraPrivileges` fuse off. A standard, secure
 * scheme also gives the renderer a real origin, which is what the production CSP's `'self'` means.
 */
export const APP_SCHEME = 'xpilot';
export const SIDEBAR_HOST = 'sidebar';
export const SIDEBAR_URL = `${APP_SCHEME}://${SIDEBAR_HOST}/index.html`;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Maps `xpilot://sidebar/<path>` onto a file under `root`. Everything else — another host, another
 * scheme, an escape through `..` or an encoded separator — returns null, so the handler serving this
 * can only ever read the built renderer directory.
 */
export function resolveSidebarAsset(root: string, requestUrl: string): { path: string; contentType: string } | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== SIDEBAR_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname === '' || pathname.endsWith('/')) pathname += 'index.html';
  const base = resolve(root);
  const file = resolve(base, `.${pathname.startsWith('/') ? '' : '/'}${pathname}`);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return { path: file, contentType: contentTypeFor(file) };
}

export interface HardenableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-attach-webview' | 'will-prevent-unload', listener: (e: { preventDefault(): void }) => void): unknown;
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
  // Without a handler Electron silently honours a page's beforeunload veto, which leaves an
  // agent-driven navigation (discarding a draft, say) stuck with no dialog to answer.
  contents.on('will-prevent-unload', (e) => e.preventDefault());
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

const BANNED_SWITCH =
  /^--(remote-debugging-(port|pipe|address)|inspect(-brk|-port)?|js-flags|user-data-dir|host-rules|host-resolver-rules|proxy-server|proxy-pac-url|ignore-certificate-errors|disable-web-security|allow-running-insecure-content|load-extension|enable-logging|renderer-cmd-prefix)(=|$)/;

/** Chromium parses these before any app code runs, so a packaged app can only refuse to continue. */
export function hasBannedSwitch(argv: readonly string[]): boolean {
  return argv.some((a) => BANNED_SWITCH.test(a));
}
