import { describe, it, expect, vi } from 'vitest';
import { createBudget, createLinkRouter, rateLimit, SHORT_LINK_BUDGET } from './links';
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

describe('createBudget', () => {
  it('allows up to max in a window and refuses after that', () => {
    let now = 0;
    const b = createBudget({ max: 3, windowMs: 1000, now: () => now });
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it('refills as the window rolls past', () => {
    let now = 0;
    const b = createBudget({ max: 2, windowMs: 1000, now: () => now });
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
    now = 1001;
    expect(b.take()).toBe(true);
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

  // Its own harness: one HEAD per short link (t.co redirects once to a plain 200) and a clock.
  const budgetDeps = () => {
    const openExternal = vi.fn();
    const loadInView = vi.fn();
    const warn = vi.fn();
    let now = 0;
    const headFetch = vi.fn(async (url: string) => (url.startsWith('https://t.co/')
      ? { status: 301, location: 'https://example.com/dest' }
      : { status: 200, location: null }));
    const router = createLinkRouter({ allowHosts: () => DEFAULT_ALLOW_HOSTS, headFetch, openExternal, loadInView, warn, now: () => now });
    return {
      router, openExternal, loadInView, warn,
      setNow: (t: number) => { now = t; },
      resolutions: () => headFetch.mock.calls.filter(([url]) => url.startsWith('https://t.co/')).length,
      lastFetch: () => headFetch.mock.calls.at(-1)?.[0],
    };
  };

  it('resolves at most SHORT_LINK_BUDGET.max short links per window, opening the rest unresolved', async () => {
    const d = budgetDeps();
    const links = Array.from({ length: SHORT_LINK_BUDGET.max + 4 }, (_, i) => `https://t.co/link${i}`);
    for (const url of links) d.router.openShortLink(url);

    await vi.waitFor(() => expect(d.openExternal).toHaveBeenCalledTimes(links.length));
    expect(d.resolutions()).toBe(SHORT_LINK_BUDGET.max);
    // The four over budget went to the browser as they came, unresolved and without a HEAD request.
    expect(d.openExternal.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(links.slice(SHORT_LINK_BUDGET.max)));
    expect(d.warn).toHaveBeenCalledTimes(4);
    expect(d.loadInView).not.toHaveBeenCalled();
  });

  it('resolves again once the budget window has rolled past', async () => {
    const d = budgetDeps();
    for (let i = 0; i <= SHORT_LINK_BUDGET.max; i++) d.router.openShortLink(`https://t.co/link${i}`);
    await vi.waitFor(() => expect(d.warn).toHaveBeenCalledTimes(1));
    expect(d.resolutions()).toBe(SHORT_LINK_BUDGET.max);

    d.setNow(SHORT_LINK_BUDGET.windowMs + 1);
    d.router.openShortLink('https://t.co/later');
    await vi.waitFor(() => expect(d.resolutions()).toBe(SHORT_LINK_BUDGET.max + 1));
    expect(d.warn).toHaveBeenCalledTimes(1);
  });

  it('applies the budget to short links clicked in the sidebar too', async () => {
    const d = budgetDeps();
    for (let i = 0; i <= SHORT_LINK_BUDGET.max; i++) d.router.openLink(`https://t.co/link${i}`);
    await vi.waitFor(() => expect(d.openExternal).toHaveBeenCalledWith(`https://t.co/link${SHORT_LINK_BUDGET.max}`));
    expect(d.resolutions()).toBe(SHORT_LINK_BUDGET.max);
  });
});
