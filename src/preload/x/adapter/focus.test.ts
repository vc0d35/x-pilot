// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeFocus, installFocusTracker } from './focus';

const here = import.meta.url;
const fixture = (n: string) => readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${n}`, here)), 'utf8');

describe('computeFocus', () => {
  it('is null on timelines', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    expect(computeFocus(document, 'https://x.com/home')).toBeNull();
  });
  it('is the main post on a status page', () => {
    document.body.innerHTML = fixture('x-status.html');
    const f = computeFocus(document, 'https://x.com/alice/status/111');
    expect(f?.post.id).toBe('111');
    expect(f?.url).toBe('https://x.com/alice/status/111');
  });
  it('is the quoted post when a reply dialog is open on the timeline', () => {
    document.body.innerHTML = fixture('x-timeline.html') + `<div role="dialog">
      <article data-testid="tweet"><div data-testid="User-Name"><a role="link" href="/bob"><span>Bob</span></a><a role="link" href="/bob"><span>@bob</span></a></div>
      <a href="/bob/status/222"><time datetime="2026-09-02T11:00:00.000Z">Sep 2</time></a><div data-testid="tweetText">Second post about rust</div></article>
      <div data-testid="tweetTextarea_0" contenteditable="true"></div></div>`;
    expect(computeFocus(document, 'https://x.com/home')?.post.id).toBe('222');
  });
});

describe('installFocusTracker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it('sends only when the focused post changes', () => {
    document.body.innerHTML = fixture('x-status.html');
    let url = 'https://x.com/alice/status/111';
    const send = vi.fn();
    const off = installFocusTracker(document, () => url, send, 100);
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]?.post.id).toBe('111');
    url = 'https://x.com/home'; document.body.innerHTML = fixture('x-timeline.html');
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBeNull();
    off();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
