import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolveKeychainGroup, configureTouchIdPasskeys } from './webauthn';

describe('resolveKeychainGroup', () => {
  it('returns null off macOS or without a team id', () => {
    expect(resolveKeychainGroup({ XPILOT_TEAM_ID: 'A1B2C3D4E5' }, 'linux')).toBeNull();
    expect(resolveKeychainGroup({}, 'darwin')).toBeNull();
    expect(resolveKeychainGroup({ XPILOT_TEAM_ID: '' }, 'darwin')).toBeNull();
  });
  it('builds <TEAM_ID>.<bundle>.webauthn and honours an explicit group', () => {
    expect(resolveKeychainGroup({ XPILOT_TEAM_ID: 'A1B2C3D4E5' }, 'darwin')).toBe('A1B2C3D4E5.com.vicnicius.xpilot.webauthn');
    expect(resolveKeychainGroup({ XPILOT_KEYCHAIN_GROUP: 'X.y.z' }, 'darwin')).toBe('X.y.z');
  });

  it('ignores the environment in a packaged build and uses the team id baked into the bundle', () => {
    const env = { XPILOT_KEYCHAIN_GROUP: 'ABC', XPILOT_TEAM_ID: 'ZZZZZZZZZZ' };
    expect(resolveKeychainGroup(env, 'darwin', { packaged: true })).toBeNull();
    expect(resolveKeychainGroup(env, 'darwin', { packaged: true, bundleTeamId: 'A1B2C3D4E5' })).toBe(
      'A1B2C3D4E5.com.vicnicius.xpilot.webauthn',
    );
    expect(resolveKeychainGroup(env, 'darwin', { packaged: false })).toBe('ABC');
  });
});

describe('configureTouchIdPasskeys', () => {
  function setup(group: string | null) {
    const app = { configureWebAuthn: vi.fn() };
    const session = new EventEmitter();
    const log = vi.fn();
    const enabled = configureTouchIdPasskeys({
      app,
      onSelectAccount: (l) => {
        session.on('select-webauthn-account', l);
      },
      group,
      log,
    });
    return { app, session, log, enabled };
  }

  it('does nothing without a group', () => {
    const { app, enabled, log } = setup(null);
    expect(enabled).toBe(false);
    expect(app.configureWebAuthn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('passkeys disabled'));
  });

  it('configures Touch ID and auto-selects a single account', () => {
    const { app, session, enabled } = setup('T.com.vicnicius.xpilot.webauthn');
    expect(enabled).toBe(true);
    expect(app.configureWebAuthn).toHaveBeenCalledWith({
      touchID: { keychainAccessGroup: 'T.com.vicnicius.xpilot.webauthn', promptReason: 'sign in to $1' },
    });
    const cb = vi.fn();
    session.emit('select-webauthn-account', { preventDefault() {} }, { accounts: [{ name: 'me', credentialId: 'cred-1' }] }, cb);
    expect(cb).toHaveBeenCalledWith('cred-1');
  });

  it('picks the most recently used account when several match and logs the choice', () => {
    const { session, log } = setup('T.g');
    const cb = vi.fn();
    session.emit(
      'select-webauthn-account',
      { preventDefault() {} },
      {
        accounts: [
          { name: 'old', credentialId: 'a' },
          { name: 'new', credentialId: 'b' },
        ],
      },
      cb,
    );
    expect(cb).toHaveBeenCalledWith('a');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 accounts'));
  });
});
