import { defineTool, fail, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { waitFor } from '../dom';
import { extractNotifications, notificationEntries } from '../extract';
import { SEL } from '../selectors';
import { openNotificationInPageDef, readNotificationsInPageDef } from './specs';

const anyEntry = () => document.querySelector(`${SEL.article}, ${SEL.notificationCell}`);

/** Internal: the entries of the Notifications page rendered in this window. */
export const readNotificationsInPage = defineTool({
  ...readNotificationsInPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    try {
      await waitFor(anyEntry, 8000);
    } catch {
      /* report whatever is there */
    }
    return ok(extractNotifications(document).slice(0, args.limit));
  },
});

/**
 * Internal: opens one entry. A reply or a mention carries its post, so its URL is the answer with
 * no click; a like, a repost or a follow links to nothing, and X reaches the post it is about with
 * a click handler on the cell — so the cell is clicked and the page followed to wherever it went.
 */
export const openNotificationInPage = defineTool({
  ...openNotificationInPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    try {
      await waitFor(anyEntry, args.timeoutMs);
    } catch {
      return fail('No notifications are rendered on this page');
    }
    const found = notificationEntries(document).find((e) => e.entry.id === args.id);
    if (!found) return fail(`No notification ${args.id} is rendered on this page; it may be further down, or gone`);
    if (found.entry.post) return ok({ id: args.id, url: found.entry.post.url, navigated: false });
    const before = location.href;
    (found.element as HTMLElement).click();
    try {
      await waitFor(() => location.href !== before, args.timeoutMs);
    } catch {
      return fail('Opening the notification did not take the page anywhere');
    }
    return ok({ id: args.id, url: location.href, navigated: true });
  },
});
