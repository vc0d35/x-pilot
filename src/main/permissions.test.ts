import { describe, it, expect } from 'vitest';
import { applyPermissionPolicy, installPermissionHandlers, X_SESSION_PERMISSIONS, type PermissionSessionLike } from './permissions';

function fakeSession() {
  const state = {
    request: null as null | ((wc: unknown, p: string, cb: (g: boolean) => void, d: unknown) => void),
    check: null as null | ((wc: unknown, p: string, o: string, d: unknown) => boolean),
    device: null as null | ((d: unknown) => boolean),
    display: null as null | ((r: unknown, cb: (s: Record<string, never>) => void) => void),
  };
  const session: PermissionSessionLike = {
    setPermissionRequestHandler: (h) => { state.request = h; },
    setPermissionCheckHandler: (h) => { state.check = h; },
    setDevicePermissionHandler: (h) => { state.device = h; },
    setDisplayMediaRequestHandler: (h) => { state.display = h; },
  };
  return {
    session,
    request(permission: string): boolean {
      let granted: boolean | null = null;
      state.request!(null, permission, (g) => { granted = g; }, {});
      if (granted === null) throw new Error('permission request handler never answered');
      return granted;
    },
    check: (permission: string) => state.check!(null, permission, 'https://x.com', {}),
    device: () => state.device!({}),
    display(): Record<string, never> {
      let streams: Record<string, never> | null = null;
      state.display!({}, (s) => { streams = s; });
      if (streams === null) throw new Error('display media handler never answered');
      return streams;
    },
    installed: () => state,
  };
}

describe('applyPermissionPolicy', () => {
  it('grants only the listed permissions and denies everything else', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS);
    expect(f.request('fullscreen')).toBe(true);
    expect(f.request('clipboard-sanitized-write')).toBe(true);
    for (const denied of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'openExternal', 'pointerLock', 'display-capture']) {
      expect(f.request(denied), denied).toBe(false);
      expect(f.check(denied), denied).toBe(false);
    }
  });

  it('answers permission checks the same way as requests', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS);
    expect(f.check('fullscreen')).toBe(true);
    expect(f.check('clipboard-sanitized-write')).toBe(true);
  });

  it('denies everything when no allow-set is given', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session);
    expect(f.request('fullscreen')).toBe(false);
    expect(f.check('fullscreen')).toBe(false);
  });

  it('refuses device access and offers no streams for screen capture', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS);
    expect(f.device()).toBe(false);
    expect(f.display()).toEqual({});
  });
});

describe('installPermissionHandlers', () => {
  it('gives the X session the small allow-set and the default session nothing', () => {
    const x = fakeSession();
    const def = fakeSession();
    installPermissionHandlers({ x: x.session as never, default: def.session as never });
    expect(x.request('fullscreen')).toBe(true);
    expect(def.request('fullscreen')).toBe(false);
    expect(def.request('media')).toBe(false);
    expect(def.device()).toBe(false);
  });

  it('installs all four handlers on both sessions', () => {
    const x = fakeSession();
    const def = fakeSession();
    installPermissionHandlers({ x: x.session as never, default: def.session as never });
    for (const f of [x, def]) {
      const state = f.installed();
      expect(state.request).toBeTypeOf('function');
      expect(state.check).toBeTypeOf('function');
      expect(state.device).toBeTypeOf('function');
      expect(state.display).toBeTypeOf('function');
    }
  });
});
