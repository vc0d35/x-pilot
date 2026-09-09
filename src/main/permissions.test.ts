import { describe, it, expect } from 'vitest';
import {
  applyPermissionPolicy,
  installPermissionHandlers,
  isAllowedPermissionOrigin,
  X_SESSION_PERMISSIONS,
  type PermissionDetails,
  type PermissionSessionLike,
} from './permissions';
import { DEFAULT_ALLOW_HOSTS } from '../shared/settings';

const onX = (url: string | undefined) => isAllowedPermissionOrigin(url, [...DEFAULT_ALLOW_HOSTS]);

function fakeSession() {
  const state = {
    request: null as null | ((wc: unknown, p: string, cb: (g: boolean) => void, d: PermissionDetails) => void),
    check: null as null | ((wc: unknown, p: string, o: string, d: PermissionDetails) => boolean),
    device: null as null | ((d: unknown) => boolean),
    display: null as null | ((r: unknown, cb: (s: Record<string, never>) => void) => void),
  };
  const session: PermissionSessionLike = {
    setPermissionRequestHandler: (h) => {
      state.request = h;
    },
    setPermissionCheckHandler: (h) => {
      state.check = h;
    },
    setDevicePermissionHandler: (h) => {
      state.device = h;
    },
    setDisplayMediaRequestHandler: (h) => {
      state.display = h;
    },
  };
  return {
    session,
    request(permission: string, details: PermissionDetails = { requestingUrl: 'https://x.com/home', isMainFrame: true }): boolean {
      let granted: boolean | null = null;
      state.request!(
        null,
        permission,
        (g) => {
          granted = g;
        },
        details,
      );
      if (granted === null) throw new Error('permission request handler never answered');
      return granted;
    },
    check: (permission: string, origin = 'https://x.com', details: PermissionDetails = { isMainFrame: true }) =>
      state.check!(null, permission, origin, details),
    device: () => state.device!({}),
    display(): Record<string, never> {
      let streams: Record<string, never> | null = null;
      state.display!({}, (s) => {
        streams = s;
      });
      if (streams === null) throw new Error('display media handler never answered');
      return streams;
    },
    installed: () => state,
  };
}

describe('isAllowedPermissionOrigin', () => {
  it('accepts only https pages on allowlisted hosts', () => {
    expect(onX('https://x.com')).toBe(true);
    expect(onX('https://mobile.x.com/home')).toBe(true);
    expect(onX('http://x.com')).toBe(false);
    expect(onX('https://ads.evil.test')).toBe(false);
    expect(onX('file:///etc/hosts')).toBe(false);
    expect(onX(undefined)).toBe(false);
    expect(onX('')).toBe(false);
  });
});

describe('applyPermissionPolicy', () => {
  it('grants only the listed permissions and denies everything else', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.request('fullscreen')).toBe(true);
    expect(f.request('clipboard-sanitized-write')).toBe(true);
    for (const denied of [
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'clipboard-read',
      'openExternal',
      'pointerLock',
      'display-capture',
    ]) {
      expect(f.request(denied), denied).toBe(false);
      expect(f.check(denied), denied).toBe(false);
    }
  });

  it('answers permission checks the same way as requests', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.check('fullscreen')).toBe(true);
    expect(f.check('clipboard-sanitized-write')).toBe(true);
  });

  it('denies a third-party origin in the same session', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.request('clipboard-sanitized-write', { requestingUrl: 'https://ads.evil.test/frame', isMainFrame: true })).toBe(false);
    expect(f.check('fullscreen', 'https://ads.evil.test')).toBe(false);
    expect(f.request('fullscreen', { requestingUrl: 'http://x.com/home', isMainFrame: true })).toBe(false);
  });

  it('denies a subframe even on an allowlisted origin', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.request('clipboard-sanitized-write', { requestingUrl: 'https://x.com/home', isMainFrame: false })).toBe(false);
    expect(f.check('fullscreen', 'https://x.com', { isMainFrame: false })).toBe(false);
  });

  it('denies a request that names no origin at all', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.request('fullscreen', {})).toBe(false);
  });

  it('denies everything when no allow-set is given', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session);
    expect(f.request('fullscreen')).toBe(false);
    expect(f.check('fullscreen')).toBe(false);
  });

  it('refuses device access and offers no streams for screen capture', () => {
    const f = fakeSession();
    applyPermissionPolicy(f.session, X_SESSION_PERMISSIONS, onX);
    expect(f.device()).toBe(false);
    expect(f.display()).toEqual({});
  });
});

describe('installPermissionHandlers', () => {
  const install = (x: PermissionSessionLike, def: PermissionSessionLike) =>
    installPermissionHandlers({ x: x as never, default: def as never, allowHosts: () => [...DEFAULT_ALLOW_HOSTS] });

  it('gives the X session the small allow-set on X origins only, and the default session nothing', () => {
    const x = fakeSession();
    const def = fakeSession();
    install(x.session, def.session);
    expect(x.request('fullscreen')).toBe(true);
    expect(x.request('fullscreen', { requestingUrl: 'https://ads.evil.test', isMainFrame: true })).toBe(false);
    expect(def.request('fullscreen')).toBe(false);
    expect(def.request('media')).toBe(false);
    expect(def.device()).toBe(false);
  });

  it('installs all four handlers on both sessions', () => {
    const x = fakeSession();
    const def = fakeSession();
    install(x.session, def.session);
    for (const f of [x, def]) {
      const state = f.installed();
      expect(state.request).toBeTypeOf('function');
      expect(state.check).toBeTypeOf('function');
      expect(state.device).toBeTypeOf('function');
      expect(state.display).toBeTypeOf('function');
    }
  });
});
