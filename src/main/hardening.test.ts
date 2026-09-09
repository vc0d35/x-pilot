import { hasBannedSwitch } from './hardening';
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { sep } from 'node:path';
import { hardenWebContents, resolveSidebarAsset, reviveOnCrash } from './hardening';
import { attachNavigationPolicy } from './navigation/policy';
import { DEFAULT_ALLOW_HOSTS } from '../shared/settings';

function fakeContents() {
  const em = new EventEmitter();
  let handler: ((d: { url: string }) => { action: string }) | null = null;
  return {
    on: (ev: string, l: (...args: never[]) => void) => em.on(ev, l as never),
    emit: (ev: string, ...args: unknown[]) => em.emit(ev, ...args),
    setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => {
      handler = h;
    },
    open: (url: string) => handler!({ url }),
    attachWebview: () => {
      const e = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      em.emit('will-attach-webview', e);
      return e.prevented;
    },
    navigate: (url: string, isMainFrame = true) => {
      const d = {
        url,
        isMainFrame,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      em.emit('will-navigate', d);
      return d.prevented;
    },
  };
}

describe('hardenWebContents', () => {
  it('denies window.open', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    expect(c.open('https://example.com')).toEqual({ action: 'deny' });
  });

  it('lets a navigation proceed past a page that tries to prevent unload', () => {
    const c = fakeContents();
    hardenWebContents(c);
    let prevented = false;
    c.emit('will-prevent-unload', { preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });

  it('prevents a <webview> from attaching', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    expect(c.attachWebview()).toBe(true);
  });

  it('attaches the navigation policy it is handed, so a WebContents nobody wired up is still guarded', () => {
    const c = fakeContents();
    const openExternal = vi.fn();
    hardenWebContents(c as never, (contents) => attachNavigationPolicy(contents, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal }));
    expect(c.navigate('https://evil.example/phish')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://evil.example/phish');
    expect(c.navigate('https://x.com/home')).toBe(false);
  });

  it('is superseded by a per-site window-open handler attached afterwards', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    attachNavigationPolicy(c, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal: () => {} });
    expect(c.open('https://accounts.google.com/x').action).toBe('allow');
    expect(c.attachWebview()).toBe(true);
  });
});

describe('reviveOnCrash', () => {
  function crashable() {
    const em = new EventEmitter();
    const reloads: number[] = [];
    let clock = 0;
    return {
      contents: {
        on: (ev: string, l: (e: unknown, d: { reason: string }) => void) => em.on(ev, l),
        isDestroyed: () => false,
        reload: () => {
          reloads.push(clock);
        },
      },
      crash: (reason = 'crashed') => em.emit('render-process-gone', {}, { reason }),
      advance: (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      reloads,
    };
  }

  it('reloads at most three times in a minute and then leaves the renderer down', () => {
    const c = crashable();
    const log = vi.fn();
    reviveOnCrash(c.contents, 'X view', { now: c.now, log });
    for (let i = 0; i < 5; i++) {
      c.crash();
      c.advance(1_000);
    }
    expect(c.reloads).toEqual([0, 1_000, 2_000]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('leaving it down'));
  });

  it('starts reloading again once the window has passed', () => {
    const c = crashable();
    reviveOnCrash(c.contents, 'X view', { now: c.now, log: () => {} });
    for (let i = 0; i < 4; i++) c.crash();
    expect(c.reloads).toHaveLength(3);
    c.advance(60_001);
    c.crash();
    expect(c.reloads).toHaveLength(4);
  });

  it('does not reload a renderer that was killed or exited cleanly', () => {
    const c = crashable();
    const log = vi.fn();
    reviveOnCrash(c.contents, 'X view', { now: c.now, log });
    c.crash('killed');
    c.crash('clean-exit');
    expect(c.reloads).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not reloading'));
    c.crash('oom');
    expect(c.reloads).toHaveLength(1);
  });
});

describe('hasBannedSwitch', () => {
  it('flags debugging and network-rewriting switches in any position', () => {
    expect(hasBannedSwitch(['/Applications/XPilot.app/Contents/MacOS/XPilot', '--remote-debugging-port=9222'])).toBe(true);
    expect(hasBannedSwitch(['x', '--inspect-brk'])).toBe(true);
    expect(hasBannedSwitch(['x', '--proxy-server=127.0.0.1:8080'])).toBe(true);
    expect(hasBannedSwitch(['x', '--user-data-dir', '/tmp/p'])).toBe(true);
  });
  it('ignores ordinary arguments', () => {
    expect(hasBannedSwitch(['x'])).toBe(false);
    expect(hasBannedSwitch(['x', '--no-sandbox-warning', 'file.txt', '--inspector-off'])).toBe(false);
  });
});

describe('resolveSidebarAsset', () => {
  const root = process.platform === 'win32' ? 'C:\\app\\out\\renderer' : '/app/out/renderer';
  const under = (...parts: string[]) => [root, ...parts].join(sep);

  it('maps a path under the sidebar host onto the renderer directory', () => {
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/index.html')).toEqual({
      path: under('index.html'),
      contentType: 'text/html; charset=utf-8',
    });
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/index-abc.js')?.path).toBe(under('assets', 'index-abc.js'));
  });

  it('serves index.html for the directory itself', () => {
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/')?.path).toBe(under('index.html'));
    expect(resolveSidebarAsset(root, 'xpilot://sidebar')?.path).toBe(under('index.html'));
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/')?.path).toBe(under('assets', 'index.html'));
  });

  it('names the content type from the extension and falls back to octet-stream', () => {
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/a.css')?.contentType).toBe('text/css; charset=utf-8');
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/a.woff2')?.contentType).toBe('font/woff2');
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/a.png')?.contentType).toBe('image/png');
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/assets/a.bin')?.contentType).toBe('application/octet-stream');
  });

  it('refuses to escape the renderer directory', () => {
    for (const url of [
      'xpilot://sidebar/../../../etc/passwd',
      'xpilot://sidebar/assets/../../../../etc/passwd',
      'xpilot://sidebar/..%2f..%2fetc%2fpasswd',
      'xpilot://sidebar/%2e%2e%2f%2e%2e%2fsettings.json',
      'xpilot://sidebar/index.html%00.png',
    ]) {
      const got = resolveSidebarAsset(root, url);
      expect(got === null || got.path.startsWith(root + sep), url).toBe(true);
      expect(got?.path.includes('..'), url).toBeFalsy();
    }
    expect(resolveSidebarAsset(root, 'xpilot://sidebar/..%2f..%2fetc%2fpasswd')).toBeNull();
  });

  it('refuses another host or another scheme', () => {
    expect(resolveSidebarAsset(root, 'xpilot://evil/index.html')).toBeNull();
    expect(resolveSidebarAsset(root, 'xpilot://sidebar.evil.com/index.html')).toBeNull();
    expect(resolveSidebarAsset(root, 'file:///etc/passwd')).toBeNull();
    expect(resolveSidebarAsset(root, 'https://sidebar/index.html')).toBeNull();
    expect(resolveSidebarAsset(root, 'not a url')).toBeNull();
  });
});
