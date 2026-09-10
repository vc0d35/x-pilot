import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewErrorBanner } from './ViewErrorBanner';
import type { ViewFailure } from '../state';

const failure: ViewFailure = {
  view: 'feed',
  phase: 'load',
  message: 'ERR_FAILED',
  at: '2026-09-10T10:00:00.000Z',
};
const banner = (props: Partial<Parameters<typeof ViewErrorBanner>[0]> = {}) =>
  renderToStaticMarkup(createElement(ViewErrorBanner, { failure, stillShowing: false, onDismiss: () => {}, onFix: () => {}, ...props }));

describe('ViewErrorBanner', () => {
  it('names the view and what went wrong, and offers X back when the view is gone', () => {
    const html = banner();
    expect(html).toContain('Custom view “feed” failed: ERR_FAILED');
    expect(html).toContain('Back to X');
    expect(html).toContain('Fix it');
    expect(html).not.toContain('Dismiss');
  });

  it('offers to be dismissed instead while the view is still on screen with its own Back to X', () => {
    const html = banner({ failure: { ...failure, phase: 'runtime', message: 'TypeError: x' }, stillShowing: true });
    expect(html).toContain('Dismiss');
    expect(html).not.toContain('Back to X');
  });

  it('is the user pressing a button: neither side effect happens on its own', () => {
    const onFix = vi.fn();
    const onDismiss = vi.fn();
    banner({ onFix, onDismiss });
    expect(onFix).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
