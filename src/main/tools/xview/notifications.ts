import { z } from 'zod';
import type { Notification } from '../../../shared/page';
import { clampedInt, defineTool, fail, ok, type ToolResult } from '../../../shared/tools';
import type { XViewLike, XViewToolCtx } from './context';
import { VIEW_ARG, cancelled, navigateStep, parseView, withView } from './target';

const NOTIFICATIONS_URL = 'https://x.com/notifications';
const MENTIONS_URL = 'https://x.com/notifications/mentions';
const ID = /^[0-9a-f]{8}$/;

/** What the user's own window says the unread count is, before a hidden read clears it; null when it cannot say. */
async function unreadOnScreen(ctx: XViewToolCtx): Promise<number | null> {
  const state = await ctx.xview.callPreload('x_get_page_state', { timeoutMs: 0 }).catch(() => null);
  const n = state?.success ? (state.content as { unreadNotifications?: unknown }).unreadNotifications : undefined;
  return typeof n === 'number' ? n : null;
}

/** Reads, scrolls and reads again, keeping one entry per id. A failed read or a stop comes back as itself. */
async function rollThrough(view: XViewLike, pages: number, signal?: AbortSignal): Promise<Notification[] | ToolResult> {
  const seen = new Map<string, Notification>();
  for (let i = 0; i < pages; i++) {
    const gone = cancelled(signal);
    if (gone) return gone;
    const r = await view.callPreload('x_read_notifications_in_page', { limit: 100 }, signal);
    if (!r.success) return r;
    for (const n of r.content as Notification[]) seen.set(n.id, n);
    const stoppedMidRoll = cancelled(signal);
    if (stoppedMidRoll) return stoppedMidRoll;
    if (i < pages - 1) await view.callPreload('x_scroll', { direction: 'down', amount: 2000 }, signal);
  }
  return [...seen.values()];
}

export const readNotifications = defineTool({
  name: 'x_read_notifications',
  description:
    'Reads the user\'s Notifications page: replies and mentions come as posts, and likes, reposts, follows and "new posts from" come as X\'s own line about who did what, with an id. Runs in a hidden window by default; pass view: "visible" to open the page in the window the user is looking at. Opening the page is what X counts as seeing the notifications, so the unread badge clears; the result reports the unread count from before. A like or repost entry carries no link to the post it is about: pass its id to x_open_notification for that.',
  args: z.strictObject({
    tab: z.enum(['all', 'mentions']).optional().describe('Which tab: everything (default) or only replies and mentions'),
    pages: clampedInt(1, 5, 'How many screens to scroll (default 1)'),
    ...VIEW_ARG,
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const unread = await unreadOnScreen(ctx);
    return withView(ctx, parseView(args), async (view) => {
      const pages = args.pages ?? 1;
      const tab = args.tab === 'mentions' ? 'mentions' : 'all';
      const stopped = await navigateStep(view, tab === 'mentions' ? MENTIONS_URL : NOTIFICATIONS_URL, signal);
      if (stopped) return stopped;
      const notifications = await rollThrough(view, pages, signal);
      if (!Array.isArray(notifications)) return notifications;
      return ok({ tab, pages, unread, notifications });
    });
  },
});

export const openNotification = defineTool({
  name: 'x_open_notification',
  description:
    'Opens one notification by the id x_read_notifications gave it and reports where it leads: the post a like, repost or reply is about (read and returned when it is one), or a profile for a follow. Runs in a hidden window by default so the screen is untouched; pass view: "visible" to take the user there.',
  args: z.strictObject({
    id: z.string().regex(ID).describe('The id of an entry from x_read_notifications'),
    pages: clampedInt(1, 5, 'How many screens to scroll looking for it (default 2)'),
    ...VIEW_ARG,
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) =>
    withView(ctx, parseView(args), async (view) => {
      const pages = args.pages ?? 2;
      const stopped = await navigateStep(view, NOTIFICATIONS_URL, signal);
      if (stopped) return stopped;
      let opened: ToolResult | null = null;
      for (let i = 0; i < pages; i++) {
        const gone = cancelled(signal);
        if (gone) return gone;
        opened = await view.callPreload('x_open_notification_in_page', { id: args.id }, signal);
        if (opened.success || !/further down/.test(opened.error ?? '')) break;
        if (i < pages - 1) await view.callPreload('x_scroll', { direction: 'down', amount: 2000 }, signal);
      }
      if (!opened?.success) return opened ?? fail('The notification was not found');
      const url = String((opened.content as { url: string }).url);
      if (!/\/status\/\d+/.test(url)) return ok({ id: args.id, url, post: null });
      const read = await view.callPreload('x_read_current_post', {}, signal);
      const post = read.success ? ((read.content as { post?: unknown }).post ?? null) : null;
      return ok({ id: args.id, url, post });
    }),
});
