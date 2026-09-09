import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { normalizePostUrl } from './read-post';
import { VIEW_ARG, cancelled, navigateStep, parseView, withView } from './target';

const LIKE_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const EXCERPT_MAX = 280;

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
async function likeDetail(ctx: XViewToolCtx, target: string): Promise<string> {
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
      const detail = await likeDetail(ctx, target);
      const decision = await ctx.approvals.request(
        {
          kind: 'post',
          title: `${action === 'like' ? 'Like' : 'Unlike'} this post?`,
          detail,
          options: [
            { id: 'yes', label: action === 'like' ? 'Like' : 'Unlike' },
            { id: 'cancel', label: 'Cancel' },
          ],
        },
        LIKE_CONFIRM_TIMEOUT_MS,
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

export const readTimeline = defineTool({
  name: 'x_read_timeline',
  description:
    'Reads the Home timeline ("For you" or "Following") by scrolling through it, returning the posts seen. Runs in a hidden window by default so the user\'s screen is untouched; pass view: "visible" to scroll the user\'s own window.',
  args: z.strictObject({
    tab: z.enum(['for_you', 'following']).optional(),
    pages: z.int().min(1).max(10).optional().describe('How many screens to scroll (default 3)'),
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
      return ok({ tab: args.tab === 'following' ? 'following' : 'for_you', pages, posts: [...seen.values()] });
    }),
});
