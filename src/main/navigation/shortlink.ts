/** x.com wraps outbound links as t.co redirects. Resolving them in main avoids opening a window just to follow a redirect. */
import { decideNavigation } from './policy';

export const SHORT_LINK_HOSTS = ['t.co'];

export function isShortLinkHost(url: string): boolean {
  try { return SHORT_LINK_HOSTS.includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

export type HeadFetch = (url: string) => Promise<{ status: number; location: string | null }>;

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0$|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i;

/**
 * A hop is only followed when it is plain https to a public host: the resolver runs in main, so
 * `file:`, `http:` and link-local or private addresses would make it a redirect-driven SSRF.
 */
export function isFollowableHop(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  return !PRIVATE_HOST.test(parsed.hostname.toLowerCase()) && !parsed.hostname.toLowerCase().endsWith('.local');
}

/**
 * Follows HTTP redirects manually (no body, no renderer) and returns the final URL. Stops at
 * `maxHops`; on any failure, or on a hop we refuse to follow, returns the last URL reached.
 * The per-hop timeout lives in the fetcher, which can abort the request it owns.
 */
export async function resolveShortLink(url: string, fetchHead: HeadFetch, maxHops = 5): Promise<string> {
  let current = url;
  try {
    for (let i = 0; i < maxHops; i++) {
      if (!isFollowableHop(current)) return current;
      const res = await fetchHead(current);
      if (res.status < 300 || res.status >= 400 || !res.location) return current;
      const next = new URL(res.location, current).toString();
      if (!isFollowableHop(next)) return current;
      current = next;
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

export function sidebarLinkAction(url: string, allowHosts: string[]): 'short' | 'view' | 'external' | 'deny' {
  if (isShortLinkHost(url)) return 'short';
  return routeShortLink(url, allowHosts);
}
