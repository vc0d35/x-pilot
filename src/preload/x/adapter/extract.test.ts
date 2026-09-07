// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageKindFromUrl, extractPost, extractVisiblePosts, findMainArticle, extractThread, extractComposer, parseStats } from './extract';
import { SEL } from './selectors';

const here = import.meta.url;
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/${name}`, here)), 'utf8');

describe('pageKindFromUrl', () => {
  it.each([
    ['https://x.com/home', 'home'],
    ['https://x.com/alice/status/111', 'post'],
    ['https://x.com/alice/status/111/photo/1', 'post'],
    ['https://x.com/i/article/123', 'article'],
    ['https://x.com/alice/article/123', 'article'],
    ['https://x.com/search?q=rust', 'search'],
    ['https://x.com/alice/likes', 'likes'],
    ['https://x.com/alice', 'profile'],
    ['https://x.com/compose/post', 'compose'],
    ['https://x.com/intent/post?text=hi', 'compose'],
    ['https://x.com/explore', 'other'],
    ['https://x.com/i/flow/login', 'other'],
  ])('%s -> %s', (url, kind) => expect(pageKindFromUrl(url)).toBe(kind));
});

describe('parseStats', () => {
  it('parses the aria-label group', () => {
    expect(parseStats('3 replies, 2 reposts, 10 likes, 1,500 views')).toEqual({ replies: 3, reposts: 2, likes: 10, views: 1500 });
    expect(parseStats('1 like')).toEqual({ replies: 0, reposts: 0, likes: 1, views: 0 });
  });
});

describe('timeline extraction', () => {
  beforeEach(() => { document.body.innerHTML = fixture('x-timeline.html'); });

  it('extracts posts with emoji alt text, author, url, time and stats', () => {
    const posts = extractVisiblePosts(document);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({
      id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', authorName: 'Alice Doe',
      text: 'Hello 🌍world', postedAt: '2026-09-01T10:00:00.000Z', kind: 'post',
      stats: { replies: 3, reposts: 2, likes: 10, views: 1500 },
    });
    expect(posts[1].text).toBe('Second post about rust');
  });

  it('returns null for an article without a permalink and no fallback', () => {
    const junk = document.querySelectorAll(SEL.article)[2];
    expect(extractPost(junk)).toBeNull();
  });

  it('reads the composer state', () => {
    expect(extractComposer(document)).toEqual({ present: false, text: '', canSubmit: false });
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"><span>draft</span></div><button data-testid="tweetButton">Post</button></div>');
    expect(extractComposer(document)).toEqual({ present: true, text: 'draft', canSubmit: true });
    document.querySelector('[data-testid="tweetButton"]')!.setAttribute('aria-disabled', 'true');
    expect(extractComposer(document).canSubmit).toBe(false);
  });
});

describe('status page extraction', () => {
  beforeEach(() => { document.body.innerHTML = fixture('x-status.html'); });

  it('finds the main article by permalink and extracts the author thread', () => {
    const url = 'https://x.com/alice/status/111';
    const main = findMainArticle(document, url)!;
    expect(main).not.toBeNull();
    const post = extractPost(main, url)!;
    expect(post.id).toBe('111');
    expect(post.text).toBe('Main post text. More text here…');
    const thread = extractThread(document, main, post.authorHandle);
    expect(thread.map((p) => p.id)).toEqual(['112', '113']);
  });

  it('falls back to the first article when no permalink matches', () => {
    const main = findMainArticle(document, 'https://x.com/i/article/555')!;
    expect(extractPost(main, 'https://x.com/i/article/555')!.id).toBe('111');
  });
});
