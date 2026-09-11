// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures';
import { pageState } from './page-state';
import { NO_POSTS_WARNING, readVisiblePosts } from './read-visible';
import { readCurrentPost } from './read-current-post';
import { showNewPosts } from './widgets';
import { adapterTools, runAdapterTool } from './index';
import { adapterToolSpecs } from './specs';
import { runTool, type ToolModule } from '../../../../shared/tools';

const ctx = {};
/** Tools are reached the way the dispatcher reaches them: arguments parsed first, defaults applied. */
const run = (tool: ToolModule<typeof ctx>, args: Record<string, unknown> = {}) => runTool(tool, args, ctx);

describe('preload tools', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers exactly the specs main compiles in, so the two halves cannot drift', () => {
    expect(adapterTools.map((t) => t.spec)).toEqual(adapterToolSpecs);
  });

  it('x_get_page_state reports kind and health', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html');
    document.title = 'Alice on X';
    const r = await run(pageState, {});
    expect(r).toEqual({
      success: true,
      content: {
        url: 'http://localhost:3000/alice/status/111',
        kind: 'post',
        title: 'Alice on X',
        adapterHealthy: true,
        health: { layout: true },
      },
    });
    document.body.innerHTML = '<div>blank</div>';
    expect((await run(pageState, { timeoutMs: 0 })) as { content: { adapterHealthy: boolean } }).toMatchObject({
      content: { adapterHealthy: false, health: { layout: false } },
    });
  });

  it('x_get_page_state reports the posts extractor separately on a timeline page', async () => {
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect((await run(pageState, {})) as { content: unknown }).toMatchObject({
      content: { adapterHealthy: true, health: { layout: true, posts: true } },
    });
    // The layout X renders is still there; only the posts inside it stopped being extractable.
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) a.removeAttribute('data-testid');
    expect((await run(pageState, { timeoutMs: 50 })) as { content: unknown }).toMatchObject({
      content: { adapterHealthy: false, health: { layout: true, posts: false } },
    });
  });

  it('x_get_page_state reports the article extractor separately on an article page', async () => {
    window.history.pushState({}, '', '/i/article/555');
    document.body.innerHTML = fixture('x-article.html');
    expect((await run(pageState, {})) as { content: unknown }).toMatchObject({
      content: { adapterHealthy: true, health: { layout: true, article: true } },
    });
    document.body.innerHTML = '<div data-testid="primaryColumn">no reader view</div>';
    expect((await run(pageState, { timeoutMs: 50 })) as { content: unknown }).toMatchObject({
      content: { adapterHealthy: false, health: { layout: true, article: false } },
    });
  });

  it('x_get_page_state waits for the layout to render after a navigation before judging health', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = '<div>still loading</div>';
    setTimeout(() => {
      document.body.innerHTML = fixture('x-status.html');
    }, 50);
    const r = (await run(pageState, { timeoutMs: 2000 })) as { content: { adapterHealthy: boolean } };
    expect(r.content.adapterHealthy).toBe(true);
    document.body.innerHTML = '<div>never renders</div>';
    const r2 = (await run(pageState, { timeoutMs: 150 })) as { content: { adapterHealthy: boolean } };
    expect(r2.content.adapterHealthy).toBe(false);
  });

  it('x_get_page_state reports the new-posts pill and x_show_new_posts clicks it', async () => {
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect((await run(pageState, {})) as { content: { newPostsAvailable?: number } }).toMatchObject({ content: { newPostsAvailable: 3 } });
    const pill = document.querySelector<HTMLElement>('[data-testid="cellInnerDiv"] button')!;
    pill.addEventListener('click', () => pill.remove());
    expect(await run(showNewPosts, {})).toMatchObject({ success: true, content: { shown: true, count: 3, kind: 'home' } });
    expect((await run(showNewPosts, {})) as { content: { shown: boolean; newPostsAvailable?: number } }).toMatchObject({
      content: { shown: false },
    });
    expect(((await run(pageState, {})) as { content: { newPostsAvailable?: number } }).content.newPostsAvailable).toBeUndefined();
  });

  it('rejects arguments that do not match the tool schema, before touching the page', async () => {
    expect(await runAdapterTool('x_read_visible_posts', { limit: 'many' }, ctx)).toEqual({
      success: false,
      error: 'Invalid arguments for x_read_visible_posts: limit: Invalid input: expected number, received string',
    });
    expect(await runAdapterTool('x_scroll', { direction: 'sideways' }, ctx)).toMatchObject({ success: false });
    expect(await runAdapterTool('x_nope', {}, ctx)).toEqual({ success: false, error: 'Unknown tool in preload: x_nope' });
  });

  it('x_read_visible_posts honours limit', async () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const r = (await run(readVisiblePosts, { limit: 1 })) as { content: unknown[] };
    expect(r.content).toHaveLength(1);
  });

  it('x_read_visible_posts warns when a timeline page yields nothing after the wait', async () => {
    const afterTheWait = async () => {
      vi.useFakeTimers();
      try {
        const p = run(readVisiblePosts, {});
        await vi.advanceTimersByTimeAsync(8000);
        return await p;
      } finally {
        vi.useRealTimers();
      }
    };
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = '<div data-testid="primaryColumn">nothing we recognise</div>';
    expect(await afterTheWait()).toEqual({ success: true, content: [], warning: NO_POSTS_WARNING });
    // A post page has no timeline to be missing, so an empty read there says nothing about health.
    window.history.pushState({}, '', '/alice/status/111');
    expect(await afterTheWait()).toEqual({ success: true, content: [] });
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    expect(await run(readVisiblePosts, {})).not.toHaveProperty('warning');
  });

  it('x_read_current_post expands show-more, returns post and thread', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html');
    let clicked = 0;
    document.querySelector<HTMLElement>('[data-testid="tweet-text-show-more-link"]')!.addEventListener('click', () => clicked++);
    const r = (await run(readCurrentPost, {})) as {
      success: boolean;
      content: { post: { id: string }; thread: { id: string }[]; article: unknown };
    };
    expect(r.success).toBe(true);
    expect(clicked).toBe(1);
    expect(r.content.post.id).toBe('111');
    expect(r.content.thread.map((p) => p.id)).toEqual(['112', '113']);
    expect(r.content.article).toBeNull();
  });

  it('x_read_current_post returns the quoted post with the post that quotes it', async () => {
    window.history.pushState({}, '', '/pilvar222/status/2098139345328959887');
    document.body.innerHTML = fixture('x-status-quote.html');
    const r = (await run(readCurrentPost, {})) as {
      content: { post: { text: string; quoted: { authorHandle: string; text: string } | null } };
    };
    expect(r.content.post.text).toContain('Why is Google proud');
    expect(r.content.post.quoted).toMatchObject({ authorHandle: 'GoogleAI', authorName: 'Google AI' });
    expect(r.content.post.quoted?.text).toContain('166,000 of the male fruit fly');
  });

  it('x_read_visible_posts returns link cards and media with the posts', async () => {
    window.history.pushState({}, '', '/home');
    document.body.innerHTML = fixture('x-timeline.html');
    const r = (await run(readVisiblePosts, {})) as { content: { id: string; cards?: unknown[]; media?: unknown[] }[] };
    expect(r.content.find((p) => p.id === '333')?.cards).toEqual([
      { url: 'https://t.co/abc123', title: 'Electron 40 ships a new renderer' },
    ]);
    expect(r.content.find((p) => p.id === '444')?.media).toEqual([
      { kind: 'image', alt: 'A chart of release cadence since 2013' },
      { kind: 'image' },
    ]);
  });

  it('x_read_current_post reads an X Article page that has no tweet element', async () => {
    window.history.pushState({}, '', '/i/article/555');
    document.body.innerHTML = fixture('x-article.html');
    const r = (await run(readCurrentPost, {})) as {
      success: boolean;
      content: {
        post: { id: string; kind: string; url: string; authorHandle: string; articleTitle?: string | null; articleBody?: string | null };
        thread: unknown[];
        article: { title: string } | null;
      };
    };
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
    const r = await run(readCurrentPost, { timeoutMs: 50 });
    expect(r).toEqual({ success: false, error: 'No post found on this page (Timed out waiting for page content)' });
  });
});
