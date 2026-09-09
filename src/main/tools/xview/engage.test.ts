import { describe, it, expect, vi } from 'vitest';
import { likePost, readTimeline } from './engage';
import { DraftStore } from './drafts';
import { ApprovalBroker } from '../../approvals';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import type { AgentEvent } from '../../../shared/agent';

function view(rendered: string[], posts: Array<Record<string, unknown>> = [], paged = false) {
  const state = { url: 'https://x.com/home', scrolls: 0 };
  return {
    state,
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => { state.url = u; }),
    callPreload: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'x_like_in_page') { const id = /status\/(\d+)/.exec(String(args.url))![1]; return rendered.includes(id) ? ok({ postId: id, liked: true, changed: true }) : fail(`Post ${id} is not rendered on this page`); }
      if (name === 'x_select_home_tab') return ok({ label: args.label, changed: true });
      if (name === 'x_read_visible_posts') return ok(paged ? posts.slice(state.scrolls, state.scrolls + 2) : posts);
      if (name === 'x_scroll') { state.scrolls++; return ok({}); }
      return fail('unexpected ' + name);
    }),
  };
}

function ctx(likesMode: 'auto' | 'confirm', visibleIds: string[], bgIds: string[], onScreen: Array<Record<string, unknown>> = []) {
  const approvals = new ApprovalBroker(); const events: AgentEvent[] = []; approvals.onEvent((e) => events.push(e));
  const xview = view(visibleIds, onScreen); const bg = view(bgIds, [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }], true);
  return { c: { xview, bg, background: async () => bg, allowHosts: () => DEFAULT_ALLOW_HOSTS, approvals, postingMode: () => 'confirm' as const, likesMode: () => likesMode, drafts: new DraftStore() }, approvals, events };
}

describe('x_like_post', () => {
  it('likes in the visible window when the post is on screen', async () => {
    const { c } = ctx('auto', ['111'], []);
    expect(await likePost.execute({ url: 'https://x.com/alice/status/111' }, c)).toEqual(ok({ postId: '111', liked: true, changed: true }));
    expect(c.bg.navigate).not.toHaveBeenCalled();
  });
  it('falls back to the hidden window otherwise, without moving the visible one', async () => {
    const { c } = ctx('auto', [], ['222']);
    expect(await likePost.execute({ url: 'https://x.com/bob/status/222' }, c)).toEqual(ok({ postId: '222', liked: true, changed: true }));
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/bob/status/222', undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
  it('asks first in confirm mode and treats a decline as final', async () => {
    const { c, approvals, events } = ctx('confirm', ['111'], []);
    const p = likePost.execute({ url: 'https://x.com/alice/status/111' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string } }).request;
    expect(req.title).toBe('Like this post?');
    approvals.resolve(req.id, 'cancel');
    expect(await p).toMatchObject({ success: true, content: { done: false, status: 'cancelled_by_user' } });
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_like_in_page', expect.anything());
  });

  it('shows the post on the confirmation card when it can be read off the screen', async () => {
    const { c, approvals, events } = ctx('confirm', ['111'], [], [
      { id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', text: 'A post   about\ncompilers' },
    ]);
    const p = likePost.execute({ url: 'https://x.com/alice/status/111' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; detail: string } }).request;
    expect(req.detail).toBe('@alice — A post about compilers\nhttps://x.com/alice/status/111');
    approvals.resolve(req.id, 'cancel');
    await p;
  });

  it('falls back to the url when the post is not on screen', async () => {
    const { c, approvals, events } = ctx('confirm', [], []);
    const p = likePost.execute({ url: 'https://x.com/bob/status/222' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; detail: string } }).request;
    expect(req.detail).toBe('https://x.com/bob/status/222');
    approvals.resolve(req.id, 'cancel');
    await p;
  });
  it('rejects non-post urls', async () => {
    expect(await likePost.execute({ url: 'https://x.com/alice' }, ctx('auto', [], []).c)).toEqual(fail('Not a post URL: https://x.com/alice'));
  });
});

describe('x_read_timeline', () => {
  it('scrolls the hidden window through the chosen tab and dedupes posts', async () => {
    const { c } = ctx('auto', [], []);
    const r = (await readTimeline.execute({ tab: 'following', pages: 3 }, c)) as { success: true; content: { tab: string; posts: { id: string }[] } };
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/home', undefined);
    expect(c.bg.callPreload).toHaveBeenCalledWith('x_select_home_tab', { label: 'Following' }, undefined);
    expect(r.content.tab).toBe('following');
    expect(r.content.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
});
