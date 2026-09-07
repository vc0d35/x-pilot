import { DEFAULT_ALLOW_HOSTS } from '../../shared/settings';

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

export interface NavigationContents {
  on(event: 'will-navigate' | 'will-redirect', listener: (e: { preventDefault(): void }, url: string) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void;
}

export function attachNavigationPolicy(
  contents: NavigationContents,
  deps: { allowHosts: () => string[]; openExternal: (url: string) => void },
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
    const decision = decideNavigation(url, deps.allowHosts(), { isPopup: true });
    if (decision === 'allow') return { action: 'allow' };
    if (decision === 'external') deps.openExternal(url);
    return { action: 'deny' };
  });
}
