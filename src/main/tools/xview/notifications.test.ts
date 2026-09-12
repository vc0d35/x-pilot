import { describe, it, expect, vi } from 'vitest';
import { openNotification, readNotifications } from './notifications';
import { ok, fail } from '../../../shared/tools';
import { DEFAULT_ALLOW_HOSTS } from '../../../shared/settings';
import { ApprovalBroker } from '../../approvals';
import { DraftStore } from './drafts';

type Entry = { id: string; kind: string; post?: { url: string } | null };
const SCREENS: Entry[][] = [
  [
    { id: 'aaaaaaaa', kind: 'post', post: { url: 'https://x.com/bob/status/1' } },
    { id: 'bbbbbbbb', kind: 'like', post: null },
  ],
  [
    { id: 'bbbbbbbb', kind: 'like', post: null },
    { id: 'cccccccc', kind: 'follow', post: null },
  ],
];

/** A window whose notifications page shows one screen per scroll, and whose like entry leads to a post. */
function view(unread: number | null = 3) {
  const state = { url: 'https://x.com/home', scrolls: 0 };
  return {
    state,
    currentUrl: () => state.url,
    navigate: vi.fn(async (u: string) => {
      state.url = u;
    }),
    callPreload: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'x_get_page_state') return ok(unread === null ? {} : { unreadNotifications: unread });
      if (name === 'x_read_notifications_in_page') return ok(SCREENS[Math.min(state.scrolls, SCREENS.length - 1)]);
      if (name === 'x_scroll') {
        state.scrolls++;
        return ok({});
      }
      if (name === 'x_open_notification_in_page') {
        const here = SCREENS[Math.min(state.scrolls, SCREENS.length - 1)].find((e) => e.id === args.id);
        if (!here) return fail(`No notification ${String(args.id)} is rendered on this page; it may be further down, or gone`);
        if (here.post) return ok({ id: args.id, url: here.post.url, navigated: false });
        if (here.kind === 'follow') {
          state.url = 'https://x.com/dave';
          return ok({ id: args.id, url: state.url, navigated: true });
        }
        state.url = 'https://x.com/v_c0d35/status/42';
        return ok({ id: args.id, url: state.url, navigated: true });
      }
      if (name === 'x_read_current_post') return ok({ post: { id: '42', url: state.url, text: 'the reply' }, thread: [], article: null });
      return fail('unexpected ' + name);
    }),
  };
}

function ctx(unread: number | null = 3) {
  const xview = view(unread);
  const bg = view(unread);
  return {
    xview,
    bg,
    background: async () => bg,
    allowHosts: () => DEFAULT_ALLOW_HOSTS,
    approvals: new ApprovalBroker(),
    postingMode: () => 'confirm' as const,
    likesMode: () => 'auto' as const,
    bookmarksMode: () => 'auto' as const,
    likes: { recordLike: vi.fn(), recordUnlike: vi.fn() },
    drafts: new DraftStore(),
  };
}

type ReadResult = { success: true; content: { tab: string; pages: number; unread: number | null; notifications: Entry[] } };

describe('x_read_notifications', () => {
  it('reads the page in the hidden window, dedupes across screens, and reports the unread count from before', async () => {
    const c = ctx();
    const r = (await readNotifications.execute({ pages: 2 }, c)) as ReadResult;
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/notifications', undefined);
    expect(c.xview.navigate).not.toHaveBeenCalled();
    expect(r.content).toMatchObject({ tab: 'all', pages: 2, unread: 3 });
    expect(r.content.notifications.map((n) => n.id)).toEqual(['aaaaaaaa', 'bbbbbbbb', 'cccccccc']);
  });

  it('opens the Mentions tab by its URL, and the visible window when asked', async () => {
    const c = ctx(null);
    const r = (await readNotifications.execute({ tab: 'mentions', pages: 1, view: 'visible' }, c)) as ReadResult;
    expect(c.xview.navigate).toHaveBeenCalledWith('https://x.com/notifications/mentions', undefined);
    expect(c.bg.navigate).not.toHaveBeenCalled();
    expect(r.content).toMatchObject({ tab: 'mentions', pages: 1, unread: null });
  });
});

describe('x_open_notification', () => {
  it('returns the post a like is about, read where the click landed', async () => {
    const c = ctx();
    expect(await openNotification.execute({ id: 'bbbbbbbb', pages: 2 }, c)).toEqual({
      success: true,
      content: {
        id: 'bbbbbbbb',
        url: 'https://x.com/v_c0d35/status/42',
        post: { id: '42', url: 'https://x.com/v_c0d35/status/42', text: 'the reply' },
      },
    });
    expect(c.bg.navigate).toHaveBeenCalledWith('https://x.com/notifications', undefined);
  });

  it('scrolls to find an entry further down, and answers a follow with the profile and no post', async () => {
    const c = ctx();
    expect(await openNotification.execute({ id: 'cccccccc', pages: 3 }, c)).toEqual({
      success: true,
      content: { id: 'cccccccc', url: 'https://x.com/dave', post: null },
    });
    expect(c.bg.state.scrolls).toBe(1);
  });

  it('gives up after the screens it was allowed, and refuses an id that is not one', async () => {
    const c = ctx();
    expect(await openNotification.execute({ id: 'zzzzzzzz'.replace(/z/g, 'f'), pages: 1 }, c)).toMatchObject({
      success: false,
      error: expect.stringContaining('further down'),
    });
    expect(c.bg.state.scrolls).toBe(0);
  });
});
