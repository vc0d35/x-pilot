import { describe, it, expect, vi } from 'vitest';
import { bookmarkPost, likePost, readBookmarks, readTimeline } from './engage';
import { DraftStore } from './drafts';
import { ApprovalBroker } from '../../approvals';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import type { AgentEvent } from '../../../shared/agent';

function view(rendered: string[], posts: Array<Record<string, unknown>> = [], paged = false, readPost?: Record<string, unknown>) {
  const state = { url: 'https://x.com/home', scrolls: 0 };
  return {
    state,
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => {
      state.url = u;
    }),
    callPreload: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'x_like_in_page' || name === 'x_bookmark_in_page') {
        const id = /status\/(\d+)/.exec(String(args.url))![1];
        if (!rendered.includes(id)) return fail(`Post ${id} is not rendered on this page`);
        return name === 'x_like_in_page'
          ? ok({ postId: id, liked: true, changed: true })
          : ok({ postId: id, bookmarked: true, changed: true });
      }
      if (name === 'x_select_home_tab') return ok({ label: args.label, changed: true });
      if (name === 'x_read_visible_posts') return ok(paged ? posts.slice(state.scrolls, state.scrolls + 2) : posts);
      if (name === 'x_read_current_post')
        return readPost ? ok({ post: readPost, thread: [], article: null }) : fail('no post on this page');
      if (name === 'x_scroll') {
        state.scrolls++;
        return ok({});
      }
      return fail('unexpected ' + name);
    }),
  };
}

/** One mode drives both confirm settings, so a test names the behaviour it wants once. */
function ctx(
  mode: 'auto' | 'confirm',
  visibleIds: string[],
  bgIds: string[],
  onScreen: Array<Record<string, unknown>> = [],
  timeline: Array<Record<string, unknown>> = [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }],
  bgPost?: Record<string, unknown>,
) {
  const approvals = new ApprovalBroker();
  const events: AgentEvent[] = [];
  approvals.onEvent((e) => events.push(e));
  const xview = view(visibleIds, onScreen);
  const bg = view(bgIds, timeline, true, bgPost);
  return {
    c: {
      xview,
      bg,
      background: async () => bg,
      allowHosts: () => DEFAULT_ALLOW_HOSTS,
      approvals,
      postingMode: () => 'confirm' as const,
      likesMode: () => mode,
      bookmarksMode: () => mode,
      likes: { recordLike: vi.fn(), recordUnlike: vi.fn() },
      drafts: new DraftStore(),
    },
    approvals,
    events,
  };
}

/** The same context, as a call a custom view made rather than one the model made. */
const fromView = <C>(c: C, name = 'timeline'): C & { origin: { kind: 'view'; name: string } } => ({
  ...c,
  origin: { kind: 'view' as const, name },
});

describe('a custom view asking for a write', () => {
  it('raises a card for a like even when likes are autonomous, and says which view asked', async () => {
    const { c, approvals, events } = ctx('auto', ['111'], []);
    const p = likePost.execute({ url: 'https://x.com/alice/status/111' }, fromView(c));
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string; origin: unknown } }).request;
    expect(req.title).toBe('Like this post?');
    expect(req.origin).toEqual({ kind: 'view', name: 'timeline' });
    approvals.resolve(req.id, 'cancel');
    expect(await p).toMatchObject({ success: true, content: { done: false, status: 'cancelled_by_user' } });
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_like_in_page', expect.anything());
  });

  it('raises a card for a bookmark even when bookmarks are autonomous', async () => {
    const { c, approvals, events } = ctx('auto', ['111'], []);
    const p = bookmarkPost.execute({ url: 'https://x.com/alice/status/111' }, fromView(c));
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string; origin: unknown } }).request;
    expect(req.title).toBe('Bookmark this post?');
    expect(req.origin).toEqual({ kind: 'view', name: 'timeline' });
    approvals.resolve(req.id, 'yes');
    expect(await p).toMatchObject({ success: true });
  });

  it('leaves an autonomous like the agent asked for as it was: no card', async () => {
    const { c, events } = ctx('auto', ['111'], []);
    expect(await likePost.execute({ url: 'https://x.com/alice/status/111' }, c)).toMatchObject({ success: true });
    expect(events).toEqual([]);
  });
});

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
    const { c, approvals, events } = ctx(
      'confirm',
      ['111'],
      [],
      [{ id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', text: 'A post   about\ncompilers' }],
    );
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
  it('records an on-screen like in the liked index, from the post it read for the card', async () => {
    const { c } = ctx(
      'auto',
      ['111'],
      [],
      [{ id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', text: 'compilers' }],
    );
    await likePost.execute({ url: 'https://x.com/alice/status/111' }, c);
    expect(c.likes.recordLike).toHaveBeenCalledWith({
      id: '111',
      url: 'https://x.com/alice/status/111',
      authorHandle: 'alice',
      authorName: '',
      text: 'compilers',
      postedAt: null,
      kind: 'post',
    });
    expect(c.likes.recordUnlike).not.toHaveBeenCalled();
  });

  it('records a like made through the hidden window from what it read there', async () => {
    const { c } = ctx('auto', [], ['222'], [], undefined, {
      id: '222',
      url: 'https://x.com/bob/status/222',
      authorHandle: 'someone-else',
      authorName: 'Bob',
      text: 'a post read in the hidden window',
      postedAt: '2026-09-09T10:00:00Z',
      kind: 'post',
    });
    await likePost.execute({ url: 'https://x.com/bob/status/222' }, c);
    expect(c.likes.recordLike).toHaveBeenCalledWith({
      id: '222',
      url: 'https://x.com/bob/status/222',
      // The permalink says who wrote it; what the page called itself does not.
      authorHandle: 'bob',
      authorName: 'Bob',
      text: 'a post read in the hidden window',
      postedAt: '2026-09-09T10:00:00Z',
      kind: 'post',
    });
  });

  it('records the like even when the post cannot be read, and records an unlike as one', async () => {
    const { c } = ctx('auto', ['111'], []);
    await likePost.execute({ url: 'https://x.com/alice/status/111' }, c);
    expect(c.likes.recordLike).toHaveBeenCalledWith(expect.objectContaining({ id: '111', authorHandle: 'alice', text: '' }));
    const un = ctx('auto', ['111'], []);
    await likePost.execute({ url: 'https://x.com/alice/status/111', action: 'unlike' }, un.c);
    expect(un.c.likes.recordUnlike).toHaveBeenCalledWith('111');
    expect(un.c.likes.recordLike).not.toHaveBeenCalled();
  });

  it('writes nothing when the like did not happen', async () => {
    const declined = ctx('confirm', ['111'], []);
    const p = likePost.execute({ url: 'https://x.com/alice/status/111' }, declined.c);
    await new Promise((r) => setTimeout(r, 0));
    declined.approvals.resolve((declined.events[0] as { request: { id: string } }).request.id, 'cancel');
    await p;
    expect(declined.c.likes.recordLike).not.toHaveBeenCalled();
    // Nowhere renders the post, so neither window could click it.
    const nowhere = ctx('auto', [], []);
    expect((await likePost.execute({ url: 'https://x.com/alice/status/111' }, nowhere.c)).success).toBe(false);
    expect(nowhere.c.likes.recordLike).not.toHaveBeenCalled();
  });

  it('rejects non-post urls', async () => {
    expect(await likePost.execute({ url: 'https://x.com/alice' }, ctx('auto', [], []).c)).toEqual(
      fail('Not a post URL: https://x.com/alice'),
    );
  });
});

describe('x_bookmark_post', () => {
  it('bookmarks in the visible window when the post is on screen', async () => {
    const { c } = ctx('auto', ['111'], []);
    expect(await bookmarkPost.execute({ url: 'https://x.com/alice/status/111' }, c)).toEqual(
      ok({ postId: '111', bookmarked: true, changed: true }),
    );
    expect(c.bg.navigate).not.toHaveBeenCalled();
  });
  it('falls back to the hidden window otherwise, without moving the visible one', async () => {
    const { c } = ctx('auto', [], ['222']);
    expect(await bookmarkPost.execute({ url: 'https://x.com/bob/status/222' }, c)).toEqual(
      ok({ postId: '222', bookmarked: true, changed: true }),
    );
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/bob/status/222', undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });
  it('asks first in confirm mode and treats a decline as final', async () => {
    const { c, approvals, events } = ctx('confirm', ['111'], []);
    const p = bookmarkPost.execute({ url: 'https://x.com/alice/status/111' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string } }).request;
    expect(req.title).toBe('Bookmark this post?');
    approvals.resolve(req.id, 'cancel');
    expect(await p).toMatchObject({ success: true, content: { done: false, status: 'cancelled_by_user' } });
    expect(c.xview.callPreload).not.toHaveBeenCalledWith('x_bookmark_in_page', expect.anything());
  });

  it('names the removal on the card, with the post when it can be read off the screen', async () => {
    const { c, approvals, events } = ctx(
      'confirm',
      ['111'],
      [],
      [{ id: '111', url: 'https://x.com/alice/status/111', authorHandle: 'alice', text: 'A post   about\ncompilers' }],
    );
    const p = bookmarkPost.execute({ url: 'https://x.com/alice/status/111', action: 'unbookmark' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; title: string; detail: string } }).request;
    expect(req.title).toBe('Remove this bookmark?');
    expect(req.detail).toBe('@alice — A post about compilers\nhttps://x.com/alice/status/111');
    approvals.resolve(req.id, 'cancel');
    await p;
  });

  it('falls back to the url when the post is not on screen', async () => {
    const { c, approvals, events } = ctx('confirm', [], []);
    const p = bookmarkPost.execute({ url: 'https://x.com/bob/status/222' }, c);
    await new Promise((r) => setTimeout(r, 0));
    const req = (events[0] as { request: { id: string; detail: string } }).request;
    expect(req.detail).toBe('https://x.com/bob/status/222');
    approvals.resolve(req.id, 'cancel');
    await p;
  });
  it('rejects non-post urls', async () => {
    expect(await bookmarkPost.execute({ url: 'https://x.com/alice' }, ctx('auto', [], []).c)).toEqual(
      fail('Not a post URL: https://x.com/alice'),
    );
  });
});

type TimelineResult = { success: true; content: { tab: string; posts: { id: string }[]; sinceId: string | null; newest: string | null } };

// Snowflakes, newest last, as a timeline read returns them.
const SNOWFLAKES = [{ id: '1900000000000000001' }, { id: '1900000000000000005' }, { id: '1900000000000000009' }, { id: 'promoted' }];

describe('x_read_timeline', () => {
  it('scrolls the hidden window through the chosen tab and dedupes posts', async () => {
    const { c } = ctx('auto', [], []);
    const r = (await readTimeline.execute({ tab: 'following', pages: 3 }, c)) as TimelineResult;
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/home', undefined);
    expect(c.bg.callPreload).toHaveBeenCalledWith('x_select_home_tab', { label: 'Following' }, undefined);
    expect(r.content.tab).toBe('following');
    expect(r.content.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(r.content.sinceId).toBeNull();
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });

  it('reports the largest id it saw, and null when no post carries a snowflake', async () => {
    const withIds = (await readTimeline.execute({ pages: 3 }, ctx('auto', [], [], [], SNOWFLAKES).c)) as TimelineResult;
    expect(withIds.content.newest).toBe('1900000000000000009');
    const withoutIds = (await readTimeline.execute({ pages: 3 }, ctx('auto', [], []).c)) as TimelineResult;
    expect(withoutIds.content.newest).toBeNull();
  });

  it('drops posts at or below sinceId, keeping newest as the largest id seen before filtering', async () => {
    const { c } = ctx('auto', [], [], [], SNOWFLAKES);
    const r = (await readTimeline.execute({ pages: 3, sinceId: '1900000000000000005' }, c)) as TimelineResult;
    expect(r.content.posts.map((p) => p.id)).toEqual(['1900000000000000009', 'promoted']);
    expect(r.content.sinceId).toBe('1900000000000000005');
    expect(r.content.newest).toBe('1900000000000000009');
  });

  it('compares ids past the safe-integer range', async () => {
    const near = [{ id: '9007199254740993' }, { id: '9007199254740992' }];
    const { c } = ctx('auto', [], [], [], near);
    const r = (await readTimeline.execute({ pages: 1, sinceId: '9007199254740992' }, c)) as TimelineResult;
    expect(r.content.posts.map((p) => p.id)).toEqual(['9007199254740993']);
  });

  it('rejects a sinceId that is not a bounded run of digits', () => {
    expect(readTimeline.args.safeParse({ sinceId: '19; DROP' }).success).toBe(false);
    expect(readTimeline.args.safeParse({ sinceId: '1'.repeat(33) }).success).toBe(false);
    expect(readTimeline.args.safeParse({ sinceId: '1900000000000000005' }).success).toBe(true);
  });
});

type BookmarksResult = { success: true; content: { pages: number; posts: { id: string }[]; newest: string | null } };

describe('x_read_bookmarks', () => {
  it('scrolls the hidden window through the bookmarks page and dedupes posts', async () => {
    const { c } = ctx('auto', [], []);
    const r = (await readBookmarks.execute({ pages: 3 }, c)) as BookmarksResult;
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/i/bookmarks', undefined);
    expect(r.content.pages).toBe(3);
    expect(r.content.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(c.xview.navigate).not.toHaveBeenCalled();
  });

  it('drives the visible window when the user asked to see them', async () => {
    const { c } = ctx('auto', [], []);
    await readBookmarks.execute({ pages: 1, view: 'visible' }, c);
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/i/bookmarks', undefined);
    expect(c.bg.navigate).not.toHaveBeenCalled();
  });

  it('reports the largest id it saw, and null when no post carries a snowflake', async () => {
    const withIds = (await readBookmarks.execute({ pages: 3 }, ctx('auto', [], [], [], SNOWFLAKES).c)) as BookmarksResult;
    expect(withIds.content.newest).toBe('1900000000000000009');
    const withoutIds = (await readBookmarks.execute({ pages: 3 }, ctx('auto', [], []).c)) as BookmarksResult;
    expect(withoutIds.content.newest).toBeNull();
  });
});
