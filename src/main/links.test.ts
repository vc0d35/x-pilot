import { describe, it, expect, vi } from 'vitest';
import { createLinkRouter, rateLimit } from './links';
import { DEFAULT_ALLOW_HOSTS } from '../shared/settings';

describe('rateLimit', () => {
  it('passes calls through up to the limit and drops the rest', () => {
    const fn = vi.fn();
    const warn = vi.fn();
    let now = 1000;
    const limited = rateLimit(fn, { max: 5, windowMs: 10_000, now: () => now, warn });
    for (let i = 0; i < 8; i++) limited(`https://example.com/${i}`);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4].map((i) => `https://example.com/${i}`));
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('lets calls through again once the window has rolled past', () => {
    const fn = vi.fn();
    let now = 0;
    const limited = rateLimit(fn, { max: 2, windowMs: 10_000, now: () => now, warn: () => {} });
    limited('a'); limited('b'); limited('c');
    expect(fn).toHaveBeenCalledTimes(2);
    now = 10_001;
    limited('d');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls.at(-1)).toEqual(['d']);
  });

  it('forwards every argument', () => {
    const fn = vi.fn();
    rateLimit(fn, { max: 1, windowMs: 10, now: () => 0 })('a', 2);
    expect(fn).toHaveBeenCalledWith('a', 2);
  });
});

describe('createLinkRouter', () => {
  const deps = (overrides: Partial<Parameters<typeof createLinkRouter>[0]> = {}) => {
    const openExternal = vi.fn();
    const loadInView = vi.fn();
    const headFetch = vi.fn(async () => ({ status: 301, location: 'https://example.com/dest' }));
    const router = createLinkRouter({ allowHosts: () => DEFAULT_ALLOW_HOSTS, headFetch, openExternal, loadInView, ...overrides });
    return { router, openExternal, loadInView, headFetch };
  };

  it('loads an allowlisted link in the view', () => {
    const d = deps();
    d.router.openLink('https://x.com/home');
    expect(d.loadInView).toHaveBeenCalledWith('https://x.com/home');
    expect(d.openExternal).not.toHaveBeenCalled();
  });

  it('sends an off-allowlist link to the system browser', () => {
    const d = deps();
    d.router.openLink('https://example.com/a');
    expect(d.openExternal).toHaveBeenCalledWith('https://example.com/a');
    expect(d.loadInView).not.toHaveBeenCalled();
  });

  it('resolves a short link before routing it', async () => {
    const d = deps();
    d.router.openLink('https://t.co/abc');
    await vi.waitFor(() => expect(d.openExternal).toHaveBeenCalledWith('https://example.com/dest'));
    expect(d.loadInView).not.toHaveBeenCalled();
  });

  it('loads a short link that resolves back onto the allowlist in the view', async () => {
    const d = deps({ headFetch: vi.fn(async () => ({ status: 301, location: 'https://x.com/alice/status/1' })) });
    d.router.openShortLink('https://t.co/abc');
    await vi.waitFor(() => expect(d.loadInView).toHaveBeenCalledWith('https://x.com/alice/status/1'));
    expect(d.openExternal).not.toHaveBeenCalled();
  });

  it('does nothing with a link that is neither navigable nor externally openable', () => {
    const d = deps();
    d.router.openLink('javascript:alert(1)');
    expect(d.openExternal).not.toHaveBeenCalled();
    expect(d.loadInView).not.toHaveBeenCalled();
  });
});
