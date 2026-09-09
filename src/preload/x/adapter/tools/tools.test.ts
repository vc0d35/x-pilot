// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures';
import { pageState } from './page-state';
import { NO_POSTS_WARNING, readVisiblePosts } from './read-visible';
import { readCurrentPost } from './read-current-post';
import { showNewPosts } from './widgets';
import { adapterTools } from './index';
import { adapterToolSpecs } from './specs';

const ctx = {};

describe('preload tools', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('registers exactly the specs main compiles in, so the two halves cannot drift', () => {
    expect(adapterTools.map((t) => t.spec)).toEqual(adapterToolSpecs);
  });

  it('x_get_page_state reports kind and health', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html');
    document.title = 'Alice on X';
    const r = await pageState.execute({}, ctx);
    expect(r).toEqual({ success: true, content: { url: 'http://localhost:3000/alice/status/111', kind: 'post', title: 'Alice on X', adapterHealthy: true, health: { layout: true } } });
    document.body.innerHTML = '<div>blank</div>';
    expect((await pageState.execute({ timeoutMs: 0 }, ctx)) as { content: { adapterHealthy: boolean } }).toMatchObject({ content: { adapterHealthy: false, health: { layout: false } } });
  });

  it('x_get_page_state reports the posts extractor separately on a timeline page', async () => {
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect((await pageState.execute({}, ctx)) as { content: unknown }).toMatchObject({ content: { adapterHealthy: true, health: { layout: true, posts: true } } });
    // The layout X renders is still there; only the posts inside it stopped being extractable.
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) a.removeAttribute('data-testid');
    expect((await pageState.execute({ timeoutMs: 50 }, ctx)) as { content: unknown }).toMatchObject({ content: { adapterHealthy: false, health: { layout: true, posts: false } } });
  });

  it('x_get_page_state reports the article extractor separately on an article page', async () => {
    window.history.pushState({}, '', '/i/article/555');
    document.body.innerHTML = fixture('x-article.html');
    expect((await pageState.execute({}, ctx)) as { content: unknown }).toMatchObject({ content: { adapterHealthy: true, health: { layout: true, article: true } } });
    document.body.innerHTML = '<div data-testid="primaryColumn">no reader view</div>';
    expect((await pageState.execute({ timeoutMs: 50 }, ctx)) as { content: unknown }).toMatchObject({ content: { adapterHealthy: false, health: { layout: true, article: false } } });
  });

  it('x_get_page_state waits for the layout to render after a navigation before judging health', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = '<div>still loading</div>';
    setTimeout(() => { document.body.innerHTML = fixture('x-status.html'); }, 50);
    const r = (await pageState.execute({ timeoutMs: 2000 }, ctx)) as { content: { adapterHealthy: boolean } };
    expect(r.content.adapterHealthy).toBe(true);
    document.body.innerHTML = '<div>never renders</div>';
    const r2 = (await pageState.execute({ timeoutMs: 150 }, ctx)) as { content: { adapterHealthy: boolean } };
    expect(r2.content.adapterHealthy).toBe(false);
  });

  it('x_get_page_state reports the new-posts pill and x_show_new_posts clicks it', async () => {
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect((await pageState.execute({}, ctx)) as { content: { newPostsAvailable?: number } }).toMatchObject({ content: { newPostsAvailable: 3 } });
    const pill = document.querySelector<HTMLElement>('[data-testid="cellInnerDiv"] button')!;
    pill.addEventListener('click', () => pill.remove());
    expect(await showNewPosts.execute({}, ctx)).toMatchObject({ success: true, content: { shown: true, count: 3, kind: 'home' } });
    expect((await showNewPosts.execute({}, ctx)) as { content: { shown: boolean; newPostsAvailable?: number } }).toMatchObject({ content: { shown: false } });
    expect(((await pageState.execute({}, ctx)) as { content: { newPostsAvailable?: number } }).content.newPostsAvailable).toBeUndefined();
  });

  it('x_read_visible_posts honours limit', async () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const r = (await readVisiblePosts.execute({ limit: 1 }, ctx)) as { content: unknown[] };
    expect(r.content).toHaveLength(1);
  });

  it('x_read_visible_posts warns when a timeline page yields nothing after the wait', async () => {
    const afterTheWait = async () => {
      vi.useFakeTimers();
      try {
        const p = readVisiblePosts.execute({}, ctx);
        await vi.advanceTimersByTimeAsync(8000);
        return await p;
      } finally { vi.useRealTimers(); }
    };
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = '<div data-testid="primaryColumn">nothing we recognise</div>';
    expect(await afterTheWait()).toEqual({ success: true, content: [], warning: NO_POSTS_WARNING });
    // A post page has no timeline to be missing, so an empty read there says nothing about health.
    window.history.pushState({}, '', '/alice/status/111');
    expect(await afterTheWait()).toEqual({ success: true, content: [] });
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect(await readVisiblePosts.execute({}, ctx)).not.toHaveProperty('warning');
  });

  it('x_read_current_post expands show-more, returns post and thread', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html');
    let clicked = 0;
    document.querySelector<HTMLElement>('[data-testid="tweet-text-show-more-link"]')!.addEventListener('click', () => clicked++);
    const r = (await readCurrentPost.execute({}, ctx)) as { success: boolean; content: { post: { id: string }; thread: { id: string }[]; article: unknown } };
    expect(r.success).toBe(true);
    expect(clicked).toBe(1);
    expect(r.content.post.id).toBe('111');
    expect(r.content.thread.map((p) => p.id)).toEqual(['112', '113']);
    expect(r.content.article).toBeNull();
  });

  it('x_read_current_post reads an X Article page that has no tweet element', async () => {
    window.history.pushState({}, '', '/i/article/555');
    document.body.innerHTML = fixture('x-article.html');
    const r = (await readCurrentPost.execute({}, ctx)) as { success: boolean; content: { post: { id: string; kind: string; url: string; authorHandle: string; articleTitle?: string | null; articleBody?: string | null }; thread: unknown[]; article: { title: string } | null } };
    expect(r.success).toBe(true);
    expect(r.content.post.id).toBe('555');
    expect(r.content.post.kind).toBe('article');
    expect(r.content.post.url).toBe('https://x.com/i/article/555');
    expect(r.content.post.authorHandle).toBe('');
    expect(r.content.post.articleTitle).toBe('On Compilers');
    expect(r.content.post.articleBody).toContain('machine code');
    expect(r.content.thread).toEqual([]);
    expect(r.content.article?.title).toBe('On Compilers');
  });

  it('x_read_current_post fails cleanly when no article appears', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    const r = await readCurrentPost.execute({ timeoutMs: 50 }, ctx);
    expect(r).toEqual({ success: false, error: 'No post found on this page (Timed out waiting for page content)' });
  });
});
