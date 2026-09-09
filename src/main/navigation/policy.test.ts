import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { decideNavigation, attachNavigationPolicy, type NavigationDetails, type WindowOpenResponse } from './policy';
import { DEFAULT_ALLOW_HOSTS } from '../../shared/settings';

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
  it('sends http to an allowlisted host to the browser instead of loading it in-app', () => {
    expect(decideNavigation('http://x.com/home', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(decideNavigation('http://t.co/abc', DEFAULT_ALLOW_HOSTS)).toBe('external');
    expect(decideNavigation('http://accounts.google.com/o/oauth2', DEFAULT_ALLOW_HOSTS, { isPopup: true })).toBe('external');
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
      on: (ev: string, l: (details: NavigationDetails) => void) => em.on(ev, l),
      setWindowOpenHandler: (h: (d: { url: string }) => WindowOpenResponse) => {
        handler = h;
      },
      emit: (ev: string, url: string, isMainFrame = true) => {
        const d = {
          url,
          isMainFrame,
          prevented: false,
          preventDefault() {
            this.prevented = true;
          },
        };
        em.emit(ev, d);
        return d.prevented;
      },
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
    expect(popup).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    });
  });

  it('blocks an off-allowlist subframe navigation without opening the browser', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    expect(c.emit('will-frame-navigate', 'https://evil.example/frame', false)).toBe(true);
    expect(c.emit('will-frame-navigate', 'http://x.com/frame', false)).toBe(true);
    expect(c.emit('will-frame-navigate', 'javascript:alert(1)', false)).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('lets an allowlisted https subframe load', () => {
    const c = fakeContents();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal: vi.fn() });
    expect(c.emit('will-frame-navigate', 'https://x.com/i/embed', false)).toBe(false);
  });

  it('leaves the main frame to will-navigate so a navigation is not decided twice', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    expect(c.emit('will-frame-navigate', 'https://example.com/a', true)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('is replaced, not stacked, when a second policy is attached to the same contents', () => {
    const c = fakeContents();
    const first = vi.fn();
    const second = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal: first });
    attachNavigationPolicy(c, { allowHosts: () => [...DEFAULT_ALLOW_HOSTS, 'accounts.google.com'], openExternal: second });
    expect(c.emit('will-navigate', 'https://accounts.google.com/o/oauth2')).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(c.emit('will-navigate', 'https://example.com/a')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('https://example.com/a');
  });

  it('lets a narrower policy attached afterwards take away the browser', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal: () => {} });
    expect(c.emit('will-navigate', 'https://example.com/a')).toBe(true);
    expect(c.open('https://example.com/a').action).toBe('deny');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('blocks a subframe redirect silently: a subframe must never reach the system browser', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal });
    expect(c.emit('will-redirect', 'https://landed.example/x', false)).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
    expect(c.emit('will-redirect', 'https://landed.example/x', true)).toBe(true);
    expect(openExternal.mock.calls).toEqual([['https://landed.example/x']]);
  });
});

describe('short links in popups', () => {
  it('never opens a window for t.co; hands the url to the short-link resolver instead', () => {
    const c = (function fakeContents() {
      let handler: ((d: { url: string }) => { action: string }) | null = null;
      return {
        on: () => {},
        setWindowOpenHandler: (h: typeof handler) => {
          handler = h;
        },
        open: (url: string) => handler!({ url }),
      };
    })();
    const openExternal = vi.fn();
    const openShortLink = vi.fn();
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal, openShortLink });
    expect(c.open('https://t.co/abc').action).toBe('deny');
    expect(openShortLink).toHaveBeenCalledWith('https://t.co/abc');
    expect(openExternal).not.toHaveBeenCalled();
    expect(c.open('https://x.com/i/flow').action).toBe('allow');
  });
});
