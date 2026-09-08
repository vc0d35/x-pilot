// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import { computeFocus, installFocusTracker } from './focus';
const allVisible = () => true;

describe('computeFocus', () => {
  it('lists the posts on screen, top to bottom, on timelines', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const f = computeFocus(document, 'https://x.com/home', allVisible);
    expect(f?.post).toBeNull();
    expect(f?.kind).toBe('home');
    expect(f?.visible?.map((v) => [v.authorHandle, v.id])).toEqual([['alice', '111'], ['bob', '222']]);
    expect(f?.visible?.[0].text).toBe('Hello 🌍world');
  });
  it('only includes posts inside the viewport', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const onlySecond = (el: Element) => el.textContent?.includes('Second post') ?? false;
    expect(computeFocus(document, 'https://x.com/home', onlySecond)?.visible?.map((v) => v.id)).toEqual(['222']);
    expect(computeFocus(document, 'https://x.com/home', () => false)).toBeNull();
  });
  it('is the main post on a status page', () => {
    document.body.innerHTML = fixture('x-status.html');
    const f = computeFocus(document, 'https://x.com/alice/status/111', allVisible);
    expect(f?.post?.id).toBe('111');
    expect(f?.url).toBe('https://x.com/alice/status/111');
  });
  it('is a synthesised article post on an X Article page with no tweet element', () => {
    document.body.innerHTML = fixture('x-article.html');
    const f = computeFocus(document, 'https://x.com/i/article/555', allVisible);
    expect(f?.post?.id).toBe('555');
    expect(f?.post?.kind).toBe('article');
    expect(f?.post?.url).toBe('https://x.com/i/article/555');
    expect(f?.post?.articleTitle).toBe('On Compilers');
    expect(f?.post?.text).toBe('On Compilers');
    expect(f?.post?.articleBody).toContain('machine code');
  });
  it('is the quoted post when a reply dialog is open on the timeline', () => {
    document.body.innerHTML = fixture('x-timeline.html') + `<div role="dialog">
      <article data-testid="tweet"><div data-testid="User-Name"><a role="link" href="/bob"><span>Bob</span></a><a role="link" href="/bob"><span>@bob</span></a></div>
      <a href="/bob/status/222"><time datetime="2026-09-02T11:00:00.000Z">Sep 2</time></a><div data-testid="tweetText">Second post about rust</div></article>
      <div data-testid="tweetTextarea_0" contenteditable="true"></div></div>`;
    expect(computeFocus(document, 'https://x.com/home', allVisible)?.post?.id).toBe('222');
  });
});

describe('installFocusTracker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('sends only when the focused post changes', () => {
    document.body.innerHTML = fixture('x-status.html');
    let url = 'https://x.com/alice/status/111';
    const send = vi.fn();
    const off = installFocusTracker(document, () => url, send, 100, allVisible);
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]?.post.id).toBe('111');
    url = 'https://x.com/home'; document.body.innerHTML = fixture('x-timeline.html');
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]?.visible?.map((v: { id: string }) => v.id)).toEqual(['111', '222']);
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(2); // same posts on screen: nothing re-sent
    document.querySelector('article')!.remove(); // scrolled past the first post
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0]?.visible?.map((v: { id: string }) => v.id)).toEqual(['222']);
    off();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('short-circuits expensive queries when URL and dialog state unchanged', () => {
    document.body.innerHTML = fixture('x-status.html');
    let url = 'https://x.com/alice/status/111';
    const send = vi.fn();
    const off = installFocusTracker(document, () => url, send, 100, allVisible);
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]?.post.id).toBe('111');
    document.body.innerHTML = fixture('x-timeline.html');
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
    url = 'https://x.com/home';
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]?.post).toBeNull();
    expect(send.mock.calls[1][0]?.visible?.map((v: { id: string }) => v.id)).toEqual(['111', '222']);
    off();
  });
});
