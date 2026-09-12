import { z } from 'zod';
import type { Post } from '../../../shared/page';
import { clampedInt, defineTool, fail, ok } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, cancelled, navigateStep, parseView, withView } from './target';

const POST_PATH = /^\/(?:[^/]+\/status\/\d+|i\/article\/\d+|[^/]+\/article\/\d+)/;

export function normalizePostUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|mobile)\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const m = POST_PATH.exec(u.pathname);
  if (!m) return null;
  return `https://x.com${m[0]}`;
}

export const readPost = defineTool({
  name: 'x_read_post',
  description:
    'Reads a post, thread, or X Article by URL: the full text, any quoted post, link cards and media, the posts it replies to (ancestors, oldest first, the last being the direct parent), the author\'s own thread continuation, the replies to it (one screen; pass pages to scroll for more), and article title/body. Reads in a hidden window and leaves the user\'s screen untouched; pass view: "visible" only when the user asked to open it on screen.',
  args: z.strictObject({ url: z.string(), pages: clampedInt(1, 5, 'How many screens of replies to read (default 1)'), ...VIEW_ARG }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const target = normalizePostUrl(args.url);
    if (!target) return fail(`Not a post or article URL: ${args.url}`);
    const requested = parseView(args);
    return withView(ctx, requested, async (view) => {
      // A background read always navigates: the visible window's URL is page-controlled (history.pushState),
      // so "the user is already on it" is not something the DOM gets to claim.
      if (requested === 'background' || normalizePostUrl(view.currentUrl()) !== target) {
        const stopped = await navigateStep(view, target, signal);
        if (stopped) return stopped;
      }
      const first = await view.callPreload('x_read_current_post', {}, signal);
      const pages = args.pages ?? 1;
      if (!first.success || pages <= 1) return first;
      const content = first.content as { post: Post; ancestors: Post[]; thread: Post[]; replies: Post[] };
      const known = new Set([content.post, ...content.ancestors, ...content.thread, ...content.replies].map((p) => p.id));
      const replies = [...content.replies];
      // Scrolling can take the main post out of the DOM, so the extra screens are read as replies only.
      for (let i = 1; i < pages; i++) {
        const gone = cancelled(signal);
        if (gone) return gone;
        await view.callPreload('x_scroll', { direction: 'down', amount: 2000 }, signal);
        const more = await view.callPreload('x_read_replies_in_page', { limit: 100 }, signal);
        if (!more.success) break;
        for (const p of more.content as Post[]) {
          if (known.has(p.id)) continue;
          known.add(p.id);
          replies.push(p);
        }
      }
      return ok({ ...content, replies, pages });
    });
  },
});
