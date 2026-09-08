/** x.com wraps outbound links as t.co redirects. Resolving them in main avoids opening a window just to follow a redirect. */
import { decideNavigation } from './policy';

export const SHORT_LINK_HOSTS = ['t.co'];

export function isShortLinkHost(url: string): boolean {
  try { return SHORT_LINK_HOSTS.includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

export type HeadFetch = (url: string) => Promise<{ status: number; location: string | null }>;

/** Follows HTTP redirects manually (no body, no renderer) and returns the final URL; on any failure returns the input. */
export async function resolveShortLink(url: string, fetchHead: HeadFetch, maxHops = 5): Promise<string> {
  let current = url;
  try {
    for (let i = 0; i < maxHops; i++) {
      const res = await fetchHead(current);
      if (res.status < 300 || res.status >= 400 || !res.location) return current;
      current = new URL(res.location, current).toString();
    }
  } catch {
    return url;
  }
  return current;
}

/** Where a resolved short link should go: an unresolved short link goes to the browser rather than the visible view. */
export function routeShortLink(target: string, allowHosts: string[]): 'view' | 'external' | 'deny' {
  if (isShortLinkHost(target)) return 'external';
  const d = decideNavigation(target, allowHosts);
  return d === 'allow' ? 'view' : d;
}
