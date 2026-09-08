import { fail, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, isToolResult, parseView, pickView } from './target';

const POST_PATH = /^\/(?:[^/]+\/status\/\d+|i\/article\/\d+|[^/]+\/article\/\d+)/;

export function normalizePostUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  const host = u.hostname.replace(/^(www|mobile)\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const m = POST_PATH.exec(u.pathname);
  if (!m) return null;
  return `https://x.com${m[0]}`;
}

export const readPost: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_read_post',
    description: 'Reads a post, thread, or X Article by URL and returns the full text, the author\'s thread, and article title/body. Reads in a hidden window (or in place when the user is already on that post); pass view: "visible" only when the user asked to open it on screen.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, ...VIEW_ARG }, required: ['url'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    const target = normalizePostUrl(String(args.url ?? ''));
    if (!target) return fail(`Not a post or article URL: ${String(args.url ?? '')}`);
    const requested = parseView(args);
    const alreadyVisible = normalizePostUrl(ctx.xview.currentUrl()) === target;
    if (alreadyVisible) return ctx.xview.callPreload('x_read_current_post', {});
    const view = await pickView(ctx, requested);
    if (isToolResult(view)) return view;
    await view.navigate(target);
    return view.callPreload('x_read_current_post', {});
  },
};
