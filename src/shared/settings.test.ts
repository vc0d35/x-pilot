import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SettingsPatchSchema, SettingsSchema, normalizeSettings } from './settings';

const parse = (patch: unknown) => SettingsPatchSchema.parse(patch);

describe('SettingsPatchSchema', () => {
  it('accepts a patch of known fields and leaves the untouched ones out of it', () => {
    expect(parse({ posting: { mode: 'autonomous' } })).toEqual({ posting: { mode: 'autonomous' } });
    expect(parse({ agent: { codex: { model: 'gpt-5' } } })).toEqual({ agent: { codex: { model: 'gpt-5' } } });
    expect(parse({ agent: { codex: { model: 'gpt-5' } } })).toEqual({ agent: { codex: { model: 'gpt-5' } } });
    expect(parse({ navigation: { allowHosts: ['x.com', '*.x.com'] } })).toEqual({ navigation: { allowHosts: ['x.com', '*.x.com'] } });
  });

  it('never accepts binPath over the patch channel: it is set through the file picker only', () => {
    for (const binPath of ['/opt/homebrew/bin/codex', 'codex', null]) expect(() => parse({ agent: { codex: { binPath } } })).toThrow(/unrecognized_key|Unrecognized/i);
  });

  it('rejects host patterns that cover a public suffix, uppercase, or anything but a hostname', () => {
    for (const host of ['*.com', '*', '', 'X.com', 'x.com/path', 'x com', '*.x.com.evil.']) {
      expect(() => parse({ navigation: { allowHosts: [host] } }), host).toThrow();
    }
    expect(() => parse({ navigation: { allowHosts: Array.from({ length: 33 }, () => 'x.com') } })).toThrow();
  });

  it('rejects unknown keys instead of merging them into the stored settings', () => {
    expect(() => parse({ agent: { codex: { sandbox: 'workspace-write' }, rogue: 1 } })).toThrow(/Unrecognized key/);
    expect(() => parse({ rogue: true })).toThrow(/Unrecognized key/);
    expect(() => parse({ library: { dir: '/tmp', extra: 1 } })).toThrow(/Unrecognized key/);
  });

  it('never fills in defaults, so a patch cannot reset the settings it does not mention', () => {
    expect(parse({ agent: { codex: {} } })).toEqual({ agent: { codex: {} } });
    expect(parse({})).toEqual({});
  });
});

describe('SettingsSchema', () => {
  it('confirms agent likes by default', () => {
    expect(DEFAULT_SETTINGS.likes.mode).toBe('confirm');
  });

  it('holds a stored settings file to the same rules as a patch', () => {
    expect(() => SettingsSchema.parse({ ...DEFAULT_SETTINGS, navigation: { allowHosts: ['*.com'] } })).toThrow();
    expect(() => normalizeSettings({ agent: { codex: { binPath: 'codex' } } })).toThrow(/absolute path/);
    expect(normalizeSettings({ likes: { mode: 'auto' } }).likes.mode).toBe('auto');
  });
});

describe('legacy settings values', () => {
  it('maps approvalPolicy "never" to the default instead of rejecting the file', () => {
    expect(normalizeSettings({ agent: { codex: { approvalPolicy: 'never' } } }).agent.codex.approvalPolicy).toBe('on-request');
  });
});
