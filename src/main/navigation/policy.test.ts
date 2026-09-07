import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { decideNavigation, attachNavigationPolicy, DEFAULT_ALLOW_HOSTS } from './policy';

describe('decideNavigation', () => {
  it('allows x.com and subdomains', () => {
    expect(decideNavigation('https://x.com/home', DEFAULT_ALLOW_HOSTS)).toBe('allow');
    expect(decideNavigation('https://mobile.x.com/i/flow/login', DEFAULT_ALLOW_HOSTS)).toBe('allow');
    expect(decideNavigation('https://t.co/abc', DEFAULT_ALLOW_HOSTS)).toBe('allow');
  });
  it('sends other hosts external', () => {
    expect(decideNavigation('https://example.com/a', DEFAULT_ALLOW_HOSTS)).toBe('external');
  });
  it('denies non-http schemes', () => {
    expect(decideNavigation('javascript:alert(1)', DEFAULT_ALLOW_HOSTS)).toBe('deny');
    expect(decideNavigation('not a url', DEFAULT_ALLOW_HOSTS)).toBe('deny');
  });
  it('allows login providers only in popups', () => {
    expect(decideNavigation('https://accounts.google.com/o/oauth2', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(decideNavigation('https://accounts.google.com/o/oauth2', DEFAULT_ALLOW_HOSTS, { isPopup: true })).toBe('allow');
  });
  it('does not treat notx.com as a subdomain of x.com', () => {
    expect(decideNavigation('https://notx.com', DEFAULT_ALLOW_HOSTS)).toBe('external');
  });
});

describe('attachNavigationPolicy', () => {
  function fakeContents() {
    const em = new EventEmitter();
    let handler: ((d: { url: string }) => { action: 'allow' | 'deny' }) | null = null;
    return {
      on: (ev: string, l: (e: { preventDefault(): void }, url: string) => void) => em.on(ev, l),
      setWindowOpenHandler: (h: (d: { url: string }) => { action: 'allow' | 'deny' }) => { handler = h; },
      emit: (ev: string, url: string) => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; em.emit(ev, e, url); return e.prevented; },
      open: (url: string) => handler!({ url }),
    };
  }

  it('cancels and externalizes off-allowlist will-navigate and will-redirect', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    expect(c.emit('will-navigate', 'https://example.com')).toBe(true);
    expect(c.emit('will-redirect', 'https://example.org')).toBe(true);
    expect(c.emit('will-navigate', 'https://x.com/explore')).toBe(false);
    expect(openExternal.mock.calls.map((a) => a[0])).toEqual(['https://example.com', 'https://example.org']);
  });

  it('window.open of external url is denied and opened externally; login popup allowed', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    expect(c.open('https://example.com').action).toBe('deny');
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    expect(c.open('https://accounts.google.com/x').action).toBe('allow');
  });
});
