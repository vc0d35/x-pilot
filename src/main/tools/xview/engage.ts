import { fail, ok, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { normalizePostUrl } from './read-post';
import { VIEW_ARG, isToolResult, parseView, pickView } from './target';

const LIKE_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

export const likePost: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_like_post',
    description: 'Likes (or unlikes) a post by URL on the user\'s behalf. Uses the visible window when the post is already on screen, otherwise a hidden window. Follows the user\'s "agent likes" setting (autonomous or confirm).',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, action: { type: 'string', enum: ['like', 'unlike'] } }, required: ['url'], additionalProperties: false },
    annotations: { destructiveHint: true },
  },
  execute: async (args, ctx) => {
    const target = normalizePostUrl(String(args.url ?? ''));
    if (!target || !target.includes('/status/')) return fail(`Not a post URL: ${String(args.url ?? '')}`);
    const action = args.action === 'unlike' ? 'unlike' : 'like';
    if (ctx.likesMode() === 'confirm') {
      const decision = await ctx.approvals.request({ kind: 'post', title: `${action === 'like' ? 'Like' : 'Unlike'} this post?`, detail: target, options: [{ id: 'yes', label: action === 'like' ? 'Like' : 'Unlike' }, { id: 'cancel', label: 'Cancel' }] }, LIKE_CONFIRM_TIMEOUT_MS);
      if (decision !== 'yes') return ok({ done: false, status: decision === 'timeout' ? 'confirmation_timed_out' : 'cancelled_by_user', reason: 'The user chose not to do this; their decision is final.' });
    }
    // Prefer the visible window when the post is already rendered there.
    const onScreen = await ctx.xview.callPreload('x_like_in_page', { url: target, action });
    if (onScreen.success) return onScreen;
    const view = await pickView(ctx, 'background');
    if (isToolResult(view)) return view;
    await view.navigate(target);
    return view.callPreload('x_like_in_page', { url: target, action });
  },
};

export const readTimeline: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_read_timeline',
    description: 'Reads the Home timeline ("For you" or "Following") by scrolling through it, returning the posts seen. Runs in a hidden window by default so the user\'s screen is untouched; pass view: "visible" to scroll the user\'s own window.',
    inputSchema: { type: 'object', properties: { tab: { type: 'string', enum: ['for_you', 'following'] }, pages: { type: 'integer', minimum: 1, maximum: 10, description: 'How many screens to scroll (default 3)' }, ...VIEW_ARG }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    const view = await pickView(ctx, parseView(args));
    if (isToolResult(view)) return view;
    const pages = Math.min(10, Math.max(1, typeof args.pages === 'number' ? args.pages : 3));
    await view.navigate('https://x.com/home');
    const tab = await view.callPreload('x_select_home_tab', { label: args.tab === 'following' ? 'Following' : 'For you' });
    if (!tab.success) return tab;
    const seen = new Map<string, unknown>();
    for (let i = 0; i < pages; i++) {
      const r = await view.callPreload('x_read_visible_posts', { limit: 100 });
      if (!r.success) return r;
      for (const p of r.content as Array<{ id: string }>) seen.set(p.id, p);
      if (i < pages - 1) await view.callPreload('x_scroll', { direction: 'down', amount: 2000 });
    }
    return ok({ tab: args.tab === 'following' ? 'following' : 'for_you', pages, posts: [...seen.values()] });
  },
};
