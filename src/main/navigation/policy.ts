import { DEFAULT_ALLOW_HOSTS } from '../../shared/settings';
import { isShortLinkHost } from './shortlink';

export { DEFAULT_ALLOW_HOSTS };
export const POPUP_ONLY_HOSTS = ['accounts.google.com', 'appleid.apple.com'];

export type NavigationDecision = 'allow' | 'external' | 'deny';

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
}

export function decideNavigation(url: string, allowHosts: string[], opts: { isPopup?: boolean } = {}): NavigationDecision {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'deny'; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'deny';
  const host = parsed.hostname.toLowerCase();
  if (allowHosts.some((p) => hostMatches(host, p))) return 'allow';
  if (opts.isPopup && POPUP_ONLY_HOSTS.some((p) => hostMatches(host, p))) return 'allow';
  return 'external';
}

/** Login popups must not inherit the X preload (or any node access): they are third-party pages. */
export function popupWindowOptions(): { webPreferences: { preload: undefined; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } } {
  return { webPreferences: { preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false } };
}

export type WindowOpenResponse =
  | { action: 'deny' }
  | { action: 'allow'; overrideBrowserWindowOptions?: { webPreferences: { preload?: string | undefined; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } } };

export interface NavigationContents {
  on(event: 'will-navigate' | 'will-redirect', listener: (e: { preventDefault(): void }, url: string) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void;
}

export function attachNavigationPolicy(
  contents: NavigationContents,
  deps: { allowHosts: () => string[]; openExternal: (url: string) => void; openShortLink?: (url: string) => void },
): void {
  const guard = (e: { preventDefault(): void }, url: string) => {
    const decision = decideNavigation(url, deps.allowHosts());
    if (decision === 'allow') return;
    e.preventDefault();
    if (decision === 'external') deps.openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    // Outbound links are t.co redirects opened in a new tab: resolve them in main instead of
    // creating a window that would be left blank once the redirect is cancelled.
    if (deps.openShortLink && isShortLinkHost(url)) { deps.openShortLink(url); return { action: 'deny' }; }
    const decision = decideNavigation(url, deps.allowHosts(), { isPopup: true });
    if (decision === 'allow') return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions() };
    if (decision === 'external') deps.openExternal(url);
    return { action: 'deny' };
  });
}
