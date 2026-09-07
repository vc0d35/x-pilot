import { fail, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';

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
    description: 'Reads a post, thread, or X Article by URL: opens it in the view if needed and returns the full text, the author\'s thread, and article title/body.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    const target = normalizePostUrl(String(args.url ?? ''));
    if (!target) return fail(`Not a post or article URL: ${String(args.url ?? '')}`);
    if (normalizePostUrl(ctx.xview.currentUrl()) !== target) await ctx.xview.navigate(target);
    return ctx.xview.callPreload('x_read_current_post', {});
  },
};
