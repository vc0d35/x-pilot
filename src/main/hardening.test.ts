import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { hardenWebContents } from './hardening';
import { attachNavigationPolicy } from './navigation/policy';
import { DEFAULT_ALLOW_HOSTS } from '../shared/settings';

function fakeContents() {
  const em = new EventEmitter();
  let handler: ((d: { url: string }) => { action: string }) | null = null;
  return {
    on: (ev: string, l: (...args: never[]) => void) => em.on(ev, l as never),
    setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => { handler = h; },
    open: (url: string) => handler!({ url }),
    attachWebview: () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; em.emit('will-attach-webview', e); return e.prevented; },
  };
}

describe('hardenWebContents', () => {
  it('denies window.open', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    expect(c.open('https://example.com')).toEqual({ action: 'deny' });
  });

  it('prevents a <webview> from attaching', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    expect(c.attachWebview()).toBe(true);
  });

  it('is superseded by a per-site window-open handler attached afterwards', () => {
    const c = fakeContents();
    hardenWebContents(c as never);
    attachNavigationPolicy(c as never, { allowHosts: () => DEFAULT_ALLOW_HOSTS, openExternal: () => {} });
    expect(c.open('https://accounts.google.com/x').action).toBe('allow');
    expect(c.attachWebview()).toBe(true);
  });
});
