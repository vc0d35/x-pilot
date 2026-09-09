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
    for (const binPath of ['/opt/homebrew/bin/codex', 'codex', null])
      expect(() => parse({ agent: { codex: { binPath } } })).toThrow(/unrecognized_key|Unrecognized/i);
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

  it('confirms agent bookmarks by default, and takes a patch for them', () => {
    expect(DEFAULT_SETTINGS.bookmarks.mode).toBe('confirm');
    expect(normalizeSettings({ bookmarks: { mode: 'auto' } }).bookmarks.mode).toBe('auto');
    expect(parse({ bookmarks: { mode: 'auto' } })).toEqual({ bookmarks: { mode: 'auto' } });
    expect(() => parse({ bookmarks: { mode: 'autonomous' } })).toThrow();
  });

  it('confirms agent-written page styles by default, since CSS can cover what the user clicks', () => {
    expect(DEFAULT_SETTINGS.styles.mode).toBe('confirm');
    expect(normalizeSettings({ styles: { mode: 'autonomous' } }).styles.mode).toBe('autonomous');
    expect(parse({ styles: { mode: 'autonomous' } })).toEqual({ styles: { mode: 'autonomous' } });
    expect(() => parse({ styles: { mode: 'auto' } })).toThrow();
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

describe('the agent provider', () => {
  it('is unset on a fresh profile, which is what raises the first-run picker', () => {
    expect(DEFAULT_SETTINGS.agent.provider).toBeNull();
  });

  it('is Codex for a profile that was already onboarded before there was a choice', () => {
    expect(normalizeSettings({ ui: { onboarded: true } }).agent.provider).toBe('codex');
    expect(normalizeSettings({ ui: { onboarded: false } }).agent.provider).toBeNull();
    // An explicit choice is never overwritten.
    expect(normalizeSettings({ ui: { onboarded: true }, agent: { provider: 'claude' } }).agent.provider).toBe('claude');
    expect(normalizeSettings({ ui: { onboarded: true }, agent: { provider: null } }).agent.provider).toBeNull();
  });

  it('rejects a provider it does not have', () => {
    expect(() => normalizeSettings({ agent: { provider: 'gemini' } })).toThrow();
    expect(() => parse({ agent: { provider: 'gemini' } })).toThrow();
    expect(parse({ agent: { provider: 'claude' } })).toEqual({ agent: { provider: 'claude' } });
  });

  it('defaults Claude to Sonnet on low effort with web search on', () => {
    expect(DEFAULT_SETTINGS.agent.claude).toEqual({ model: 'claude-sonnet-5', effort: 'low', webSearch: 'on', binPath: null });
  });

  it('takes a Claude patch but never its binary path, which only the file picker sets', () => {
    expect(parse({ agent: { claude: { model: 'claude-opus-5', effort: 'max' } } })).toEqual({
      agent: { claude: { model: 'claude-opus-5', effort: 'max' } },
    });
    expect(() => parse({ agent: { claude: { effort: 'ultra' } } })).toThrow();
    expect(() => parse({ agent: { claude: { binPath: '/usr/local/bin/claude' } } })).toThrow();
    expect(normalizeSettings({ agent: { claude: { binPath: '/usr/local/bin/claude' } } }).agent.claude.binPath).toBe(
      '/usr/local/bin/claude',
    );
  });
});
