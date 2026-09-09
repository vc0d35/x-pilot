import { describe, it, expect, vi } from 'vitest';
import { listSelectors, setSelector, resetSelector } from './selectors';
import type { AppToolCtx, SelectorTest } from './context';
import type { SelectorInfo, SelectorSetResult } from '../../page-config/selectors';

const INFO: SelectorInfo[] = [
  { key: 'article', description: 'One post', default: 'article', effective: 'article', status: 'default' },
  { key: 'tweetText', description: 'The text', default: '[data-testid="tweetText"]', effective: '.legacy', status: 'stale' },
];

function ctx(opts: { write?: SelectorSetResult; tried?: SelectorTest | null; noView?: boolean } = {}) {
  const set = vi.fn((): SelectorSetResult => opts.write ?? { ok: true, previous: 'article', status: 'overridden' });
  const reset = vi.fn(() => true);
  const resetAll = vi.fn();
  const testSelector = vi.fn(async (): Promise<SelectorTest | null> => opts.tried ?? { valid: true, count: 3 });
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

  it('refuses a selector the browser cannot parse, and writes nothing', async () => {
    const c = ctx({ tried: { valid: false, count: 0 } });
    expect(await setSelector.execute({ key: 'tweetText', selector: ':::' }, c.value)).toEqual({
      success: false,
      error: 'That is not a valid CSS selector: :::',
    });
    expect(c.set).not.toHaveBeenCalled();
  });

  it('reports a match count of zero rather than refusing, so the agent can see the selector is wrong', async () => {
    const c = ctx({ tried: { valid: true, count: 0 } });
    expect(await setSelector.execute({ key: 'tweetText', selector: '.nothing' }, c.value)).toMatchObject({
      success: true,
      content: { matchesOnCurrentPage: 0 },
    });
  });

  it('passes on the store’s refusal', async () => {
    const c = ctx({ write: { ok: false, reason: 'the selector is empty' } });
    expect(await setSelector.execute({ key: 'tweetText', selector: ' ' }, c.value)).toEqual({
      success: false,
      error: 'Rejected: the selector is empty',
    });
  });

  it('writes without a match count in a run that has no window, and says so', async () => {
    const c = ctx({ noView: true });
    const r = await setSelector.execute({ key: 'tweetText', selector: '.legacy' }, c.value);
    expect(r).toMatchObject({ success: true, content: { matchesOnCurrentPage: null }, warning: expect.stringContaining('not tried') });
    expect(c.set).toHaveBeenCalledWith('tweetText', '.legacy');
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
