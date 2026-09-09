import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SELECTOR_LENGTH, SELECTORS_COMMENT, SelectorOverrides } from './selectors';
import { SELECTOR_DEFAULTS, type SelectorKey } from '../../shared/selectors';

const open: SelectorOverrides[] = [];
const store = (opts: { defaults?: Record<SelectorKey, string>; dir?: string } = {}) => {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'xpilot-'));
  const s = new SelectorOverrides(join(dir, 'selectors.json'), { appVersion: '0.1.0', defaults: opts.defaults, debounceMs: 20 });
  open.push(s);
  return { store: s, dir };
};

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('SelectorOverrides', () => {
  it('creates the file with the comment that stands in for the ones JSON cannot carry', () => {
    const { store: s } = store();
    expect(s.effective()).toEqual(SELECTOR_DEFAULTS);
    const written = JSON.parse(readFileSync(s.path, 'utf8')) as { _comment: string; appVersion: string; overrides: object };
    expect(written).toEqual({ _comment: SELECTORS_COMMENT, appVersion: '0.1.0', overrides: {} });
    expect(written._comment).toMatch(/stale/);
  });

  it('stores only the overridden key, with the default it replaced', () => {
    const { store: s } = store();
    expect(s.set('tweetText', '.legacy-text')).toEqual({
      ok: true,
      previous: SELECTOR_DEFAULTS.tweetText,
      status: 'overridden',
    });
    expect(JSON.parse(readFileSync(s.path, 'utf8')).overrides).toEqual({
      tweetText: { selector: '.legacy-text', replacedDefault: SELECTOR_DEFAULTS.tweetText },
    });
    expect(s.overrides()).toEqual({ tweetText: '.legacy-text' });
    expect(s.effective()).toEqual({ ...SELECTOR_DEFAULTS, tweetText: '.legacy-text' });
  });

  it('lists every key with its description, default, effective value and status', () => {
    const { store: s } = store();
    s.set('tweetText', '.legacy-text');
    const list = s.list();
    expect(list).toHaveLength(Object.keys(SELECTOR_DEFAULTS).length);
    expect(list.find((i) => i.key === 'tweetText')).toEqual({
      key: 'tweetText',
      description: expect.stringContaining('text'),
      default: SELECTOR_DEFAULTS.tweetText,
      effective: '.legacy-text',
      status: 'overridden',
    });
    expect(list.find((i) => i.key === 'article')).toMatchObject({ effective: SELECTOR_DEFAULTS.article, status: 'default' });
    expect(s.counts()).toEqual({ overridden: 1, stale: 0 });
  });

  it('flags an override as stale once the shipped default it replaced has changed', () => {
    const { store: s, dir } = store();
    s.set('tweetText', '.legacy-text');
    s.close();
    // The next version of the app ships a different default for the same key.
    const { store: next } = store({ dir, defaults: { ...SELECTOR_DEFAULTS, tweetText: '[data-testid="postText"]' } });
    expect(next.list().find((i) => i.key === 'tweetText')).toMatchObject({
      default: '[data-testid="postText"]',
      effective: '.legacy-text',
      status: 'stale',
    });
    expect(next.counts()).toEqual({ overridden: 1, stale: 1 });
  });

  it('lets a new default through for every key that was not overridden', () => {
    const { store: s, dir } = store();
    s.set('tweetText', '.legacy-text');
    s.close();
    const { store: next } = store({ dir, defaults: { ...SELECTOR_DEFAULTS, article: 'section[data-testid="post"]' } });
    expect(next.effective()).toMatchObject({ article: 'section[data-testid="post"]', tweetText: '.legacy-text' });
  });

  it('refuses an unknown key and an unusable selector', () => {
    const { store: s } = store();
    expect(s.set('nope', 'div')).toEqual({ ok: false, reason: expect.stringContaining('there is no selector called "nope"') });
    expect(s.set('article', '   ')).toEqual({ ok: false, reason: 'the selector is empty' });
    expect(s.set('article', 'a'.repeat(MAX_SELECTOR_LENGTH + 1))).toEqual({
      ok: false,
      reason: `the selector is longer than ${MAX_SELECTOR_LENGTH} characters`,
    });
    expect(s.overrides()).toEqual({});
  });

  it('trims the selector and keeps one at the length cap', () => {
    const { store: s } = store();
    const long = 'a'.repeat(MAX_SELECTOR_LENGTH);
    expect(s.set('article', `  ${long}  `)).toMatchObject({ ok: true });
    expect(s.overrides()).toEqual({ article: long });
  });

  it('resets one key and all of them', () => {
    const { store: s } = store();
    s.set('tweetText', '.a');
    s.set('article', '.b');
    expect(s.reset('tweetText')).toBe(true);
    expect(s.reset('tweetText')).toBe(false);
    expect(s.reset('nope')).toBe(false);
    expect(s.overrides()).toEqual({ article: '.b' });
    s.resetAll();
    expect(s.overrides()).toEqual({});
    expect(s.effective()).toEqual(SELECTOR_DEFAULTS);
  });

  it('reports every change to its listeners', () => {
    const { store: s } = store();
    const seen: Partial<Record<SelectorKey, string>>[] = [];
    const off = s.onChange((o) => seen.push(o));
    s.set('article', '.b');
    s.resetAll();
    off();
    s.set('article', '.c');
    expect(seen).toEqual([{ article: '.b' }, {}]);
  });

  it('keeps a corrupt file for the user and carries on with the shipped selectors', () => {
    const { store: s, dir } = store();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(s.path, '{ not json');
    expect(s.effective()).toEqual(SELECTOR_DEFAULTS);
    expect(readdirSync(dir).some((f) => f.startsWith('selectors.json.corrupt-'))).toBe(true);
    warn.mockRestore();
    // The file comes back, so the next write has somewhere to go.
    expect(s.set('article', '.b')).toMatchObject({ ok: true });
    expect(existsSync(s.path)).toBe(true);
  });

  it('ignores a key it does not know, so a file from a newer version still works', () => {
    const { store: s } = store();
    writeFileSync(
      s.path,
      JSON.stringify({
        overrides: { article: { selector: '.b', replacedDefault: 'x' }, futureKey: { selector: '.c', replacedDefault: '' } },
      }),
    );
    expect(s.overrides()).toEqual({ article: '.b' });
    expect(s.list().find((i) => i.key === 'article')).toMatchObject({ status: 'stale' });
  });
});
