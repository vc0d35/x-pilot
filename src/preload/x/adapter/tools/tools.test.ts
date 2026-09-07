// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageState } from './page-state';
import { readVisiblePosts } from './read-visible';
import { readCurrentPost } from './read-current-post';
import { createPageToolHost } from '../../page-tools';

const here = import.meta.url;
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../../../tests/fixtures/${name}`, here)), 'utf8');
const ctx = { pageTools: createPageToolHost() };

describe('preload tools', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('x_get_page_state reports kind and health', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    document.body.innerHTML = fixture('x-status.html');
    document.title = 'Alice on X';
    const r = await pageState.execute({}, ctx);
    expect(r).toEqual({ success: true, content: { url: 'http://localhost:3000/alice/status/111', kind: 'post', title: 'Alice on X', adapterHealthy: true } });
    document.body.innerHTML = '<div>blank</div>';
    expect((await pageState.execute({}, ctx)) as { content: { adapterHealthy: boolean } }).toMatchObject({ content: { adapterHealthy: false } });
  });

  it('x_read_visible_posts honours limit', async () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const r = (await readVisiblePosts.execute({ limit: 1 }, ctx)) as { content: unknown[] };
    expect(r.content).toHaveLength(1);
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

  it('x_read_current_post fails cleanly when no article appears', async () => {
    window.history.pushState({}, '', '/alice/status/111');
    const r = await readCurrentPost.execute({ timeoutMs: 50 }, ctx);
    expect(r).toEqual({ success: false, error: 'No post found on this page (Timed out waiting for page content)' });
  });
});
