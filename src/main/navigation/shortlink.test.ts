import { describe, it, expect, vi } from 'vitest';
import { resolveShortLink, isFollowableHop, isShortLinkHost, routeShortLink, sidebarLinkAction } from './shortlink';
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

  it('stops at the default hop limit of five', async () => {
    const f = vi.fn(async (url: string) => ({ status: 301, location: `${url}x` }));
    await expect(resolveShortLink('https://t.co/a', f)).resolves.toBe('https://t.co/axxxxx');
    expect(f).toHaveBeenCalledTimes(5);
  });

  it('refuses a hop that leaves https, and never fetches it', async () => {
    for (const hop of ['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data', 'ftp://example.com/x']) {
      const f = fetcher({ 'https://t.co/a': hop });
      await expect(resolveShortLink('https://t.co/a', f)).resolves.toBe('https://t.co/a');
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a hop to a private or link-local address', async () => {
    for (const hop of ['https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://10.0.0.1/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x', 'https://[::1]/x', 'https://printer.local/x']) {
      const f = fetcher({ 'https://t.co/a': hop });
      await expect(resolveShortLink('https://t.co/a', f), hop).resolves.toBe('https://t.co/a');
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves a live chain through to an x.com status, so the view branch is reachable again', async () => {
    const f = fetcher({ 'https://t.co/a': 'https://bit.ly/b', 'https://bit.ly/b': 'https://x.com/attacker/status/1', 'https://x.com/attacker/status/1': null });
    const target = await resolveShortLink('https://t.co/a', f);
    expect(target).toBe('https://x.com/attacker/status/1');
    expect(routeShortLink(target, DEFAULT_ALLOW_HOSTS)).toBe('view');
  });

  it('never fetches a starting url that is not a public https url', async () => {
    const f = fetcher({});
    await expect(resolveShortLink('file:///etc/hosts', f)).resolves.toBe('file:///etc/hosts');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('isFollowableHop', () => {
  it('accepts public https and rejects everything else', () => {
    expect(isFollowableHop('https://example.com/a')).toBe(true);
    expect(isFollowableHop('https://t.co/a')).toBe(true);
    expect(isFollowableHop('http://example.com/a')).toBe(false);
    expect(isFollowableHop('file:///etc/passwd')).toBe(false);
    expect(isFollowableHop('https://0.0.0.0/a')).toBe(false);
    expect(isFollowableHop('not a url')).toBe(false);
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

describe('sidebarLinkAction', () => {
  it('routes short links to resolution, x.com to the view, others to the browser', () => {
    expect(sidebarLinkAction('https://t.co/abc', DEFAULT_ALLOW_HOSTS)).toBe('short');
    expect(sidebarLinkAction('https://x.com/a/status/1', DEFAULT_ALLOW_HOSTS)).toBe('view');
    expect(sidebarLinkAction('https://example.com/x', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(sidebarLinkAction('javascript:alert(1)', DEFAULT_ALLOW_HOSTS)).toBe('deny');
  });
});
