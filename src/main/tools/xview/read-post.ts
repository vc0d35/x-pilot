import { z } from 'zod';
import { defineTool, fail } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, navigateStep, parseView, withView } from './target';

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
    'Reads a post, thread, or X Article by URL and returns the full text, the author\'s thread, and article title/body. Reads in a hidden window and leaves the user\'s screen untouched; pass view: "visible" only when the user asked to open it on screen.',
  args: z.strictObject({ url: z.string(), ...VIEW_ARG }),
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
      return view.callPreload('x_read_current_post', {}, signal);
    });
  },
});
