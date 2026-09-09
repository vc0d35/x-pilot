// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { SEL, applySelectorOverrides } from './selectors';
import { testSelector } from './tools/test-selector';
import { SELECTOR_DEFAULTS } from '../../../shared/selectors';
import { runTool } from '../../../shared/tools';

afterEach(() => applySelectorOverrides({}));

describe('applySelectorOverrides', () => {
  it('starts from the shipped defaults', () => {
    expect({ ...SEL }).toEqual(SELECTOR_DEFAULTS);
  });

  it('replaces entries in place, so the call sites that captured SEL see the new value', () => {
    const captured = SEL;
    applySelectorOverrides({ tweetText: '.legacy-text' });
    expect(captured.tweetText).toBe('.legacy-text');
    expect(captured.article).toBe(SELECTOR_DEFAULTS.article);
  });

  it('puts every key back to its default before applying, so an override that goes away is undone', () => {
    applySelectorOverrides({ tweetText: '.legacy-text' });
    applySelectorOverrides({ article: '.post' });
    expect(SEL.tweetText).toBe(SELECTOR_DEFAULTS.tweetText);
    expect(SEL.article).toBe('.post');
  });

  it('ignores a key it does not know and an empty selector', () => {
    applySelectorOverrides({ futureKey: '.x', tweetText: '   ' });
    expect({ ...SEL }).toEqual(SELECTOR_DEFAULTS);
  });
});

describe('x_test_selector', () => {
  it('counts what a selector matches on this page', async () => {
    document.body.innerHTML = '<p class="a"></p><p class="a"></p>';
    expect(await runTool(testSelector, { selector: '.a' }, {})).toEqual({ success: true, content: { valid: true, count: 2 } });
    expect(await runTool(testSelector, { selector: '.b' }, {})).toEqual({ success: true, content: { valid: true, count: 0 } });
  });

  it('reports a selector the browser cannot parse instead of throwing', async () => {
    expect(await runTool(testSelector, { selector: ':::' }, {})).toEqual({ success: true, content: { valid: false, count: 0 } });
  });
});
