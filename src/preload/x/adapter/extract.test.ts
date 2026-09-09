// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import { pageKindFromUrl, extractPost, extractVisiblePosts, findMainArticle, extractThread, extractComposer, parseStats, postFromArticleUrl , extractArticle } from './extract';
import { SEL } from './selectors';

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

describe('postFromArticleUrl', () => {
  it('synthesises an article post from /i/article and /handle/article urls', () => {
    expect(postFromArticleUrl('https://x.com/i/article/555', 'On Compilers')).toMatchObject({ id: '555', kind: 'article', url: 'https://x.com/i/article/555', authorHandle: '', text: 'On Compilers' });
    expect(postFromArticleUrl('https://x.com/alice/article/777')).toMatchObject({ id: '777', kind: 'article', url: 'https://x.com/alice/article/777', authorHandle: 'alice', text: '' });
  });
  it('returns null for non-article urls', () => {
    expect(postFromArticleUrl('https://x.com/alice/status/111')).toBeNull();
    expect(postFromArticleUrl('not a url')).toBeNull();
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

  it('falls back to the first article on a non-status page', () => {
    const main = findMainArticle(document, 'https://x.com/i/article/555')!;
    expect(extractPost(main, 'https://x.com/i/article/555')!.id).toBe('111');
  });

  it('returns no main article when the page is a status page and nothing on it carries that permalink', () => {
    expect(findMainArticle(document, 'https://x.com/victim/status/9999999')).toBeNull();
  });

  it('stops the thread at an impostor whose display name matches but whose permalink does not', () => {
    const main = findMainArticle(document, 'https://x.com/alice/status/111')!;
    document.querySelectorAll(SEL.article)[1].insertAdjacentHTML('beforebegin', `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a role="link" href="/alice"><span>Alice Doe</span></a><a role="link" href="/alice"><span>@alice</span></a></div>
        <a href="/attacker/status/2" role="link"><time datetime="2026-09-01T10:00:30.000Z">Sep 1</time></a>
        <div data-testid="tweetText"><span>Impostor continuation</span></div>
      </article>`);
    expect(extractThread(document, main, 'alice')).toEqual([]);
  });
});

describe('page-controlled identity', () => {
  const hostile = (attrs: string, permalink: string) => `
    <article data-testid="tweet"${attrs}>
      <div data-testid="User-Name"><a role="link" href="/nytimes"><span>@nytimes</span></a></div>
      <a href="${permalink}" role="link"><time datetime="2026-09-01T10:00:00.000Z">Sep 1</time></a>
      <div data-testid="tweetText"><span>attacker chosen text</span></div>
    </article>`;

  beforeEach(() => { document.body.innerHTML = fixture('x-status.html'); });

  it('takes the handle from the permalink, never from the display name', () => {
    document.body.insertAdjacentHTML('beforeend', hostile('', '/attacker/status/1734000000000000000'));
    const post = extractPost(document.querySelectorAll(SEL.article)[4])!;
    expect(post.authorHandle).toBe('attacker');
    expect(post.url).toBe('https://x.com/attacker/status/1734000000000000000');
    expect(post.authorName).not.toContain('nytimes');
  });

  it('rejects permalinks that are not exactly /handle/status/<digits>', () => {
    for (const href of ['/vic\ntim/status/1', '/a/status/1x', '/a b/status/1', '/toolongahandlename1/status/1', '/a/status/', '/a/statuses/1']) {
      document.body.insertAdjacentHTML('beforeend', hostile('', href));
      const article = [...document.querySelectorAll(SEL.article)].at(-1)!;
      expect(extractPost(article), href).toBeNull();
    }
  });

  it('ignores a hidden injected article carrying the page permalink', () => {
    const url = 'https://x.com/alice/status/111';
    document.body.insertAdjacentHTML('afterbegin', hostile(' style="display:none"', '/attacker/status/111'));
    document.body.insertAdjacentHTML('afterbegin', hostile(' style="visibility:hidden"', '/attacker/status/111'));
    const main = findMainArticle(document, url)!;
    const post = extractPost(main, url)!;
    expect(post.authorHandle).toBe('alice');
    expect(post.text).toBe('Main post text. More text here…');
  });

  it('returns no main article when only a hidden article matches the page id', () => {
    document.body.innerHTML = hostile(' style="display:none"', '/attacker/status/424242');
    expect(findMainArticle(document, 'https://x.com/victim/status/424242')).toBeNull();
  });
});

describe('article extraction', () => {
  it('reads the dedicated title element and only the rich-text body, excluding author chrome', () => {
    document.body.innerHTML = fixture('x-article.html');
    const a = extractArticle(document)!;
    expect(a.title).toBe('On Compilers');
    expect(a.body).toContain('machine code');
    expect(a.body).toContain('Heading');
    expect(a.body).not.toContain('Follow');
    expect(a.body).not.toContain('11217');
  });
});
