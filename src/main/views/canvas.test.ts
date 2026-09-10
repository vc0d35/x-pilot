import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { VIEW_LOG_LIMIT, VIEW_LOG_TEXT_MAX } from '../../shared/views';
import { ViewLogs, attachCanvasNavigationPolicy, type NavigationLike } from './canvas';

function fakeContents() {
  const em = new EventEmitter();
  let handler: (() => { action: string }) | null = null;
  return {
    on: (event: string, listener: (details: NavigationLike) => void) => em.on(event, listener),
    setWindowOpenHandler: (h: () => { action: 'deny' }) => {
      handler = h;
    },
    open: () => handler!(),
    navigate: (url: string, event = 'will-navigate', isMainFrame = true) => {
      const details = {
        url,
        isMainFrame,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      em.emit(event, details);
      return details.prevented;
    },
  };
}

describe('attachCanvasNavigationPolicy', () => {
  it('keeps a canvas inside the view it is showing', () => {
    const c = fakeContents();
    let active: string | null = 'xpilot://views/feed/';
    attachCanvasNavigationPolicy(c, () => active);
    expect(c.navigate('xpilot://views/feed/page-two.html')).toBe(false);
    for (const url of ['xpilot://views/other/index.html', 'https://x.com/home', 'file:///etc/passwd', 'about:blank'])
      expect(c.navigate(url), url).toBe(true);
    expect(c.navigate('xpilot://views/feed/frame.html', 'will-redirect')).toBe(false);
    expect(c.navigate('https://evil.example/', 'will-frame-navigate', false)).toBe(true);
    // With no view showing there is nothing to be inside of, so nothing is allowed.
    active = null;
    expect(c.navigate('xpilot://views/feed/page-two.html')).toBe(true);
  });

  it('opens no windows', () => {
    const c = fakeContents();
    attachCanvasNavigationPolicy(c, () => 'xpilot://views/feed/');
    expect(c.open()).toEqual({ action: 'deny' });
  });
});

describe('ViewLogs', () => {
  it('keeps the newest entries per view and caps how long a line can be', () => {
    const logs = new ViewLogs();
    for (let i = 0; i < VIEW_LOG_LIMIT + 10; i++) logs.add('feed', { source: 'console', level: 'info', text: `line ${i}` });
    logs.add('other', { source: 'console', level: 'error', text: 'x'.repeat(VIEW_LOG_TEXT_MAX + 100) });
    const feed = logs.get('feed', 500);
    expect(feed).toHaveLength(VIEW_LOG_LIMIT);
    expect(feed[0].text).toBe('line 10');
    expect(feed.at(-1)).toMatchObject({ text: `line ${VIEW_LOG_LIMIT + 9}`, source: 'console', level: 'info' });
    expect(logs.get('other', 10)[0].text).toHaveLength(VIEW_LOG_TEXT_MAX + 1);
  });

  it('returns the newest few, of one view or of all of them', () => {
    const logs = new ViewLogs();
    logs.add('a', { source: 'console', level: 'info', text: 'one', at: '2026-01-01T00:00:00.000Z' });
    logs.add('b', { source: 'crash', level: 'error', text: 'two', at: '2026-01-01T00:00:01.000Z' });
    logs.add('a', { source: 'console', level: 'info', text: 'three', at: '2026-01-01T00:00:02.000Z' });
    expect(logs.get('a', 1).map((e) => e.text)).toEqual(['three']);
    expect(logs.get(undefined, 10).map((e) => e.text)).toEqual(['one', 'two', 'three']);
    expect(logs.views()).toEqual(['a', 'b']);
    logs.clear('a');
    expect(logs.get('a', 10)).toEqual([]);
  });
});
