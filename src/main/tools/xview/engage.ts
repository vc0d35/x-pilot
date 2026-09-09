import { z } from 'zod';
import { defineTool, fail, ok, clampedInt, type ToolResult } from '../../../shared/tools';
import type { XViewLike, XViewToolCtx } from './context';
import { normalizePostUrl } from './read-post';
import { VIEW_ARG, cancelled, navigateStep, parseView, withView } from './target';

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const EXCERPT_MAX = 280;
const POST_ID_MAX = 32;
const DIGITS = /^\d+$/;

interface VisiblePostRow {
  url?: unknown;
  authorHandle?: unknown;
  text?: unknown;
}

/** The rows arrive as parsed JSON from the preload: anything that is not a string is not a field. */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * What to show on the confirmation card. A status id is not something a user can check, so the
 * post is read off the screen when it happens to be there; otherwise the URL is all there is.
 */
async function cardDetail(ctx: XViewToolCtx, target: string): Promise<string> {
  try {
    const seen = await ctx.xview.callPreload('x_read_visible_posts', { limit: 100 });
    if (!seen.success || !Array.isArray(seen.content)) return target;
    const match = (seen.content as VisiblePostRow[]).find((p) => normalizePostUrl(str(p?.url)) === target);
    if (!match) return target;
    const text = str(match.text).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
    const handle = str(match.authorHandle).replace(/\s+/g, ' ').trim();
    if (!text && !handle) return target;
    return `${handle ? `@${handle}` : 'Unknown author'} — ${text}\n${target}`;
  } catch {
    return target;
  }
}

export const likePost = defineTool({
  name: 'x_like_post',
  description:
    'Likes (or unlikes) a post by URL on the user\'s behalf. Uses the visible window when the post is already on screen, otherwise a hidden window. Follows the user\'s "agent likes" setting (autonomous or confirm).',
  args: z.strictObject({ url: z.string(), action: z.enum(['like', 'unlike']).optional() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const target = normalizePostUrl(args.url);
    if (!target || !target.includes('/status/')) return fail(`Not a post URL: ${args.url}`);
    const action = args.action ?? 'like';
    const stopped = cancelled(signal);
    if (stopped) return stopped;
    if (ctx.likesMode() === 'confirm') {
      const detail = await cardDetail(ctx, target);
      const { decision } = await ctx.approvals.request(
        {
          kind: 'post',
          title: `${action === 'like' ? 'Like' : 'Unlike'} this post?`,
          detail,
          options: [
            { id: 'yes', label: action === 'like' ? 'Like' : 'Unlike' },
            { id: 'cancel', label: 'Cancel' },
          ],
        },
        CONFIRM_TIMEOUT_MS,
      );
      if (decision !== 'yes')
        return ok({
          done: false,
          status: decision === 'timeout' ? 'confirmation_timed_out' : 'cancelled_by_user',
          reason: 'The user chose not to do this; their decision is final.',
        });
      const afterApproval = cancelled(signal);
      if (afterApproval) return afterApproval;
    }
    // Prefer the visible window when the post is already rendered there.
    const onScreen = await ctx.xview.callPreload('x_like_in_page', { url: target, action }, signal);
    if (onScreen.success) return onScreen;
    return withView(ctx, 'background', async (view) => {
      const gone = await navigateStep(view, target, signal);
      if (gone) return gone;
      return view.callPreload('x_like_in_page', { url: target, action }, signal);
    });
  },
});

export const bookmarkPost = defineTool({
  name: 'x_bookmark_post',
  description:
    'Bookmarks (or removes a bookmark from) a post by URL on the user\'s behalf. Bookmarks are private to the user, so this is a good way to save something for later without a public signal. Uses the visible window when the post is already on screen, otherwise a hidden window. Follows the user\'s "bookmarks" setting (autonomous or confirm).',
  args: z.strictObject({ url: z.string(), action: z.enum(['bookmark', 'unbookmark']).optional() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const target = normalizePostUrl(args.url);
    if (!target || !target.includes('/status/')) return fail(`Not a post URL: ${args.url}`);
    const action = args.action ?? 'bookmark';
    const stopped = cancelled(signal);
    if (stopped) return stopped;
    if (ctx.bookmarksMode() === 'confirm') {
      const detail = await cardDetail(ctx, target);
      const { decision } = await ctx.approvals.request(
        {
          kind: 'post',
          title: action === 'bookmark' ? 'Bookmark this post?' : 'Remove this bookmark?',
          detail,
          options: [
            { id: 'yes', label: action === 'bookmark' ? 'Bookmark' : 'Remove' },
            { id: 'cancel', label: 'Cancel' },
          ],
        },
        CONFIRM_TIMEOUT_MS,
      );
      if (decision !== 'yes')
        return ok({
          done: false,
          status: decision === 'timeout' ? 'confirmation_timed_out' : 'cancelled_by_user',
          reason: 'The user chose not to do this; their decision is final.',
        });
      const afterApproval = cancelled(signal);
      if (afterApproval) return afterApproval;
    }
    // Prefer the visible window when the post is already rendered there.
    const onScreen = await ctx.xview.callPreload('x_bookmark_in_page', { url: target, action }, signal);
    if (onScreen.success) return onScreen;
    return withView(ctx, 'background', async (view) => {
      const gone = await navigateStep(view, target, signal);
      if (gone) return gone;
      return view.callPreload('x_bookmark_in_page', { url: target, action }, signal);
    });
  },
});

/** X post ids are increasing snowflakes, so they order the timeline; anything else is not one. */
const snowflake = (id: unknown): bigint | null => (typeof id === 'string' && DIGITS.test(id) ? BigInt(id) : null);

type PostRow = { id?: unknown };

/**
 * Reads what is on screen, scrolls, and repeats, keeping one entry per post id: how every list of
 * posts is rolled through, whichever page it is. A failed read or a stop comes back as itself.
 */
async function rollThrough(view: XViewLike, pages: number, signal?: AbortSignal): Promise<PostRow[] | ToolResult> {
  const seen = new Map<string, unknown>();
  for (let i = 0; i < pages; i++) {
    const gone = cancelled(signal);
    if (gone) return gone;
    const r = await view.callPreload('x_read_visible_posts', { limit: 100 }, signal);
    if (!r.success) return r;
    for (const p of r.content as Array<{ id: string }>) seen.set(p.id, p);
    const stoppedMidRoll = cancelled(signal);
    if (stoppedMidRoll) return stoppedMidRoll;
    if (i < pages - 1) await view.callPreload('x_scroll', { direction: 'down', amount: 2000 }, signal);
  }
  return [...seen.values()] as PostRow[];
}

const rolled = (r: PostRow[] | ToolResult): r is PostRow[] => Array.isArray(r);

/** The largest snowflake in a read, as the watermark a later read can start from. */
function newestOf(posts: PostRow[]): string | null {
  let newest: bigint | null = null;
  for (const p of posts) {
    const n = snowflake(p.id);
    if (n !== null && (newest === null || n > newest)) newest = n;
  }
  return newest === null ? null : String(newest);
}

export const readTimeline = defineTool({
  name: 'x_read_timeline',
  description:
    'Reads the Home timeline ("For you" or "Following") by scrolling through it, returning the posts seen. Runs in a hidden window by default so the user\'s screen is untouched; pass view: "visible" to scroll the user\'s own window. Pass sinceId to get only posts newer than one already read; the result reports `newest`, the largest id seen.',
  args: z.strictObject({
    tab: z.enum(['for_you', 'following']).optional(),
    pages: clampedInt(1, 10, 'How many screens to scroll (default 3)'),
    sinceId: z
      .string()
      .regex(DIGITS)
      .max(POST_ID_MAX)
      .optional()
      .describe('Drop posts with this id or older; use the `newest` id from an earlier read'),
    ...VIEW_ARG,
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) =>
    withView(ctx, parseView(args), async (view) => {
      const pages = args.pages ?? 3;
      const stopped = await navigateStep(view, 'https://x.com/home', signal);
      if (stopped) return stopped;
      const tab = await view.callPreload('x_select_home_tab', { label: args.tab === 'following' ? 'Following' : 'For you' }, signal);
      if (!tab.success) return tab;
      const all = await rollThrough(view, pages, signal);
      if (!rolled(all)) return all;
      const newest = newestOf(all);
      const sinceId = args.sinceId ?? null;
      const floor = sinceId === null ? null : BigInt(sinceId);
      // A post whose id is not a snowflake cannot be placed against the watermark, so it is kept.
      const posts =
        floor === null
          ? all
          : all.filter((p) => {
              const n = snowflake(p.id);
              return n === null || n > floor;
            });
      return ok({ tab: args.tab === 'following' ? 'following' : 'for_you', pages, posts, sinceId, newest });
    }),
});

export const readBookmarks = defineTool({
  name: 'x_read_bookmarks',
  description:
    'Reads the posts the user has bookmarked, by scrolling through their Bookmarks page and returning what it saw. Bookmarks are private to the user, and this is where to look for something they saved earlier. Runs in a hidden window by default so the screen is untouched; pass view: "visible" to open Bookmarks in the window the user is looking at.',
  args: z.strictObject({ pages: clampedInt(1, 10, 'How many screens to scroll (default 3)'), ...VIEW_ARG }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) =>
    withView(ctx, parseView(args), async (view) => {
      const pages = args.pages ?? 3;
      const stopped = await navigateStep(view, 'https://x.com/i/bookmarks', signal);
      if (stopped) return stopped;
      const posts = await rollThrough(view, pages, signal);
      if (!rolled(posts)) return posts;
      return ok({ pages, posts, newest: newestOf(posts) });
    }),
});
