import { describe, it, expect, vi } from 'vitest';
import { resolveShortLink, isShortLinkHost, routeShortLink } from './shortlink';
import { DEFAULT_ALLOW_HOSTS } from '../../shared/settings';

const fetcher = (hops: Record<string, string | null>) => vi.fn(async (url: string) => {
  const next = hops[url];
  return next === undefined ? { status: 404, location: null } : next === null ? { status: 200, location: null } : { status: 301, location: next };
});

describe('isShortLinkHost', () => {
  it('matches t.co only', () => {
    expect(isShortLinkHost('https://t.co/abc')).toBe(true);
    expect(isShortLinkHost('https://x.com/t.co')).toBe(false);
    expect(isShortLinkHost('not a url')).toBe(false);
  });
});

describe('resolveShortLink', () => {
  it('follows redirects to the final URL', async () => {
    const f = fetcher({ 'https://t.co/a': 'https://example.com/x', 'https://example.com/x': null });
    await expect(resolveShortLink('https://t.co/a', f)).resolves.toBe('https://example.com/x');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('resolves relative Location headers and stops at the hop limit', async () => {
    const f = fetcher({ 'https://t.co/a': '/b', 'https://t.co/b': 'https://t.co/c', 'https://t.co/c': 'https://t.co/a' });
    await expect(resolveShortLink('https://t.co/a', f, 3)).resolves.toBe('https://t.co/a');
  });
  it('returns the input when the request fails', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    await expect(resolveShortLink('https://t.co/a', f)).resolves.toBe('https://t.co/a');
  });
});

describe('routeShortLink', () => {
  it('sends x.com targets to the view, others to the browser, unresolved short links to the browser', () => {
    expect(routeShortLink('https://x.com/a/status/1', DEFAULT_ALLOW_HOSTS)).toBe('view');
    expect(routeShortLink('https://example.com/a', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(routeShortLink('https://t.co/dead', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(routeShortLink('javascript:alert(1)', DEFAULT_ALLOW_HOSTS)).toBe('deny');
  });
});
