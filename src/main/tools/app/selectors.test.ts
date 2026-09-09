import { describe, it, expect, vi } from 'vitest';
import { listSelectors, testSelectorTool, setSelector, resetSelector } from './selectors';
import type { AppToolCtx, SelectorTest } from './context';
import type { SelectorInfo, SelectorSetResult } from '../../page-config/selectors';

const INFO: SelectorInfo[] = [
  { key: 'article', description: 'One post', default: 'article', effective: 'article', status: 'default', locked: false },
  { key: 'tweetText', description: 'The text', default: '[data-testid="tweetText"]', effective: '.legacy', status: 'stale', locked: false },
  { key: 'postButton', description: 'The Post button', default: 'button', effective: 'button', status: 'default', locked: true },
];

function ctx(opts: { write?: SelectorSetResult; tried?: SelectorTest | null; noView?: boolean } = {}) {
  const set = vi.fn((): SelectorSetResult => opts.write ?? { ok: true, previous: 'article', status: 'overridden' });
  const reset = vi.fn(() => true);
  const resetAll = vi.fn();
  const testSelector = vi.fn(async (): Promise<SelectorTest | null> => (opts.tried === undefined ? { valid: true, count: 3 } : opts.tried));
  return {
    set,
    reset,
    resetAll,
    testSelector,
    value: {
      selectors: { path: '/profile/selectors.json', appVersion: '0.1.0', list: () => INFO, set, reset, resetAll },
      testSelector: opts.noView ? null : testSelector,
    } as unknown as AppToolCtx,
  };
}

describe('xpilot_list_selectors', () => {
  it('returns the catalogue, where it lives and the version it was listed for', async () => {
    expect(await listSelectors.execute({}, ctx().value)).toEqual({
      success: true,
      content: { appVersion: '0.1.0', path: '/profile/selectors.json', selectors: INFO },
    });
  });

  it('marks the keys that drive actions as locked', async () => {
    const r = (await listSelectors.execute({}, ctx().value)) as { content: { selectors: SelectorInfo[] } };
    expect(r.content.selectors.find((i) => i.key === 'postButton')?.locked).toBe(true);
    expect(r.content.selectors.find((i) => i.key === 'article')?.locked).toBe(false);
  });
});

describe('xpilot_test_selector', () => {
  it('reports what a selector matches without writing anything', async () => {
    const c = ctx({ tried: { valid: true, count: 7 } });
    expect(await testSelectorTool.execute({ selector: '.a' }, c.value)).toEqual({
      success: true,
      content: { selector: '.a', valid: true, count: 7 },
    });
    expect(c.set).not.toHaveBeenCalled();
  });

  it('reports an unparsable selector as invalid rather than failing', async () => {
    const c = ctx({ tried: { valid: false, count: 0 } });
    expect(await testSelectorTool.execute({ selector: ':::' }, c.value)).toMatchObject({
      success: true,
      content: { valid: false, count: 0 },
    });
  });

  it('says so when there is no window to try it in', async () => {
    expect(await testSelectorTool.execute({ selector: '.a' }, ctx({ noView: true }).value)).toMatchObject({
      success: false,
      error: expect.stringContaining('no window'),
    });
  });
});

describe('xpilot_set_selector', () => {
  it('tries the selector on the page first, then writes it', async () => {
    const c = ctx();
    expect(await setSelector.execute({ key: 'tweetText', selector: '.legacy' }, c.value)).toEqual({
      success: true,
      content: { key: 'tweetText', selector: '.legacy', matchesOnCurrentPage: 3, previous: 'article', status: 'overridden' },
    });
    expect(c.testSelector).toHaveBeenCalledWith('.legacy');
    expect(c.set).toHaveBeenCalledWith('tweetText', '.legacy');
  });

  it('refuses a key that drives an action, whatever it would match', async () => {
    for (const key of ['composerTextarea', 'postButton', 'likeButton', 'unlikeButton', 'homeTab', 'showMore', 'dialog', 'toast']) {
      const c = ctx();
      expect(await setSelector.execute({ key, selector: '#danger' }, c.value)).toMatchObject({
        success: false,
        error: expect.stringContaining('cannot be changed from a tool'),
      });
      expect(c.set).not.toHaveBeenCalled();
      expect(c.testSelector).not.toHaveBeenCalled();
    }
  });

  it('refuses a selector the browser cannot parse, and writes nothing', async () => {
    const c = ctx({ tried: { valid: false, count: 0 } });
    expect(await setSelector.execute({ key: 'tweetText', selector: ':::' }, c.value)).toEqual({
      success: false,
      error: 'That is not a valid CSS selector: :::',
    });
    expect(c.set).not.toHaveBeenCalled();
  });

  it('reports a match count of zero with a warning rather than refusing: the element may not be on this page', async () => {
    const c = ctx({ tried: { valid: true, count: 0 } });
    expect(await setSelector.execute({ key: 'tweetText', selector: '.nothing' }, c.value)).toMatchObject({
      success: true,
      content: { matchesOnCurrentPage: 0 },
      warning: expect.stringContaining('matches nothing'),
    });
    expect(c.set).toHaveBeenCalled();
  });

  it('passes on the store’s refusal', async () => {
    const c = ctx({ write: { ok: false, reason: 'the selector is empty' } });
    expect(await setSelector.execute({ key: 'tweetText', selector: ' ' }, c.value)).toEqual({
      success: false,
      error: 'Rejected: the selector is empty',
    });
  });

  it('writes nothing when the probe could not be run', async () => {
    const c = ctx({ tried: null });
    expect(await setSelector.execute({ key: 'tweetText', selector: '.legacy' }, c.value)).toMatchObject({
      success: false,
      error: expect.stringContaining('could not be tried'),
    });
    expect(c.set).not.toHaveBeenCalled();
  });

  it('writes nothing in a run that has no window', async () => {
    const c = ctx({ noView: true });
    expect(await setSelector.execute({ key: 'tweetText', selector: '.legacy' }, c.value)).toMatchObject({
      success: false,
      error: expect.stringContaining('no window'),
    });
    expect(c.set).not.toHaveBeenCalled();
  });
});

describe('xpilot_reset_selector', () => {
  it('puts one key back to the shipped selector', async () => {
    const c = ctx();
    expect(await resetSelector.execute({ key: 'tweetText' }, c.value)).toEqual({
      success: true,
      content: { key: 'tweetText', selector: '[data-testid="tweetText"]', wasOverridden: true, status: 'default' },
    });
    expect(c.reset).toHaveBeenCalledWith('tweetText');
  });

  it('removes every override', async () => {
    const c = ctx();
    expect(await resetSelector.execute({ all: true }, c.value)).toEqual({
      success: true,
      content: { reset: 'all', path: '/profile/selectors.json' },
    });
    expect(c.resetAll).toHaveBeenCalled();
  });

  it('refuses an unknown key and a call that says nothing', async () => {
    const c = ctx();
    expect(await resetSelector.execute({ key: 'nope' }, c.value)).toMatchObject({ success: false });
    expect(await resetSelector.execute({}, c.value)).toMatchObject({ success: false });
    expect(c.reset).not.toHaveBeenCalled();
    expect(c.resetAll).not.toHaveBeenCalled();
  });
});
