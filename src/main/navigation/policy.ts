import { isShortLinkHost } from './shortlink';

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
  try {
    parsed = new URL(url);
  } catch {
    return 'deny';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'deny';
  const host = parsed.hostname.toLowerCase();
  // Only https loads in-app: a downgraded link to an allowlisted host goes to the browser
  // rather than putting the X session on a connection anyone can rewrite.
  if (parsed.protocol === 'https:') {
    if (allowHosts.some((p) => hostMatches(host, p))) return 'allow';
    if (opts.isPopup && POPUP_ONLY_HOSTS.some((p) => hostMatches(host, p))) return 'allow';
  }
  return 'external';
}

/** Login popups must not inherit the X preload (or any node access): they are third-party pages. */
export function popupWindowOptions(): {
  webPreferences: { preload: undefined; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
} {
  return { webPreferences: { preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false } };
}

export type WindowOpenResponse =
  | { action: 'deny' }
  | {
      action: 'allow';
      overrideBrowserWindowOptions?: {
        webPreferences: { preload?: string | undefined; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
      };
    };

/** Electron hands all three navigation events a details object carrying the URL and the frame. */
export interface NavigationDetails {
  url: string;
  isMainFrame?: boolean;
  preventDefault(): void;
}

export interface NavigationContents {
  on(event: 'will-navigate' | 'will-redirect' | 'will-frame-navigate', listener: (details: NavigationDetails) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void;
}

export interface NavigationPolicyDeps {
  allowHosts: () => string[];
  openExternal: (url: string) => void;
  openShortLink?: (url: string) => void;
}

/**
 * The policy in force for a WebContents. Every WebContents is given one the moment it is created,
 * and a few are then given a narrower or wider one (login popups add hosts, an unattended window
 * drops openExternal). Keeping the deps here rather than in the closures means a later attach
 * replaces the earlier policy instead of stacking a second, contradictory set of listeners.
 */
const policies = new WeakMap<NavigationContents, NavigationPolicyDeps>();

export function attachNavigationPolicy(contents: NavigationContents, deps: NavigationPolicyDeps): void {
  const installed = policies.has(contents);
  policies.set(contents, deps);
  if (installed) return;
  const current = () => policies.get(contents) ?? deps;

  const guard = (details: NavigationDetails) => {
    const active = current();
    const decision = decideNavigation(details.url, active.allowHosts());
    if (decision === 'allow') return;
    details.preventDefault();
    // A subframe never reaches the system browser: an off-allowlist iframe redirect would
    // otherwise let a page spray browser windows with no user interaction.
    if (decision === 'external' && details.isMainFrame !== false) active.openExternal(details.url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  // will-navigate is main-frame only; will-frame-navigate is the subframe event and fires for the
  // main frame too, so only subframes are taken here to avoid deciding the same navigation twice.
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame === false) guard(details);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const active = current();
    // Outbound links are t.co redirects opened in a new tab: resolve them in main instead of
    // creating a window that would be left blank once the redirect is cancelled.
    if (active.openShortLink && isShortLinkHost(url)) {
      active.openShortLink(url);
      return { action: 'deny' };
    }
    const decision = decideNavigation(url, active.allowHosts(), { isPopup: true });
    if (decision === 'allow') return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions() };
    if (decision === 'external') active.openExternal(url);
    return { action: 'deny' };
  });
}
