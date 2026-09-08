import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { decideNavigation, attachNavigationPolicy, DEFAULT_ALLOW_HOSTS, type WindowOpenResponse } from './policy';

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
    let handler: ((d: { url: string }) => WindowOpenResponse) | null = null;
    return {
      on: (ev: string, l: (e: { preventDefault(): void }, url: string) => void) => em.on(ev, l),
      setWindowOpenHandler: (h: (d: { url: string }) => WindowOpenResponse) => { handler = h; },
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
    const popup = c.open('https://accounts.google.com/x');
    expect(popup.action).toBe('allow');
    expect(popup).toEqual({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false } } });
  });
});

describe('short links in popups', () => {
  it('never opens a window for t.co; hands the url to the short-link resolver instead', () => {
    const c = (function fakeContents() {
      let handler: ((d: { url: string }) => { action: string }) | null = null;
      return { on: () => {}, setWindowOpenHandler: (h: typeof handler) => { handler = h; }, open: (url: string) => handler!({ url }) };
    })();
    const openExternal = vi.fn();
    const openShortLink = vi.fn();
    attachNavigationPolicy(c as never, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal, openShortLink });
    expect(c.open('https://t.co/abc').action).toBe('deny');
    expect(openShortLink).toHaveBeenCalledWith('https://t.co/abc');
    expect(openExternal).not.toHaveBeenCalled();
    expect(c.open('https://x.com/i/flow').action).toBe('allow');
  });
});
