import { fail, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, navigateStep, parseView, withView } from './target';

export const search: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_search',
    description: 'Runs an x.com search (supports X search operators like from:user, since:YYYY-MM-DD) and returns the first page of results. Runs in a hidden window by default; pass view: "visible" only when the user wants to see the results on screen.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, ...VIEW_ARG }, required: ['query'], additionalProperties: false },
  },
  execute: async (args, ctx, signal) => {
    const q = String(args.query ?? '').trim();
    if (!q) return fail('query is required');
    return withView(ctx, parseView(args), async (view) => {
      const stopped = await navigateStep(view, `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`, signal);
      if (stopped) return stopped;
      return view.callPreload('x_read_visible_posts', { limit: 20 }, signal);
    });
  },
};
