import { z } from 'zod';
import { defineTool, fail } from '../../../shared/tools';
import type { XViewToolCtx } from './context';
import { VIEW_ARG, navigateStep, parseView, withView } from './target';

export const search = defineTool({
  name: 'x_search',
  description:
    'Runs an x.com search (supports X search operators like from:user, since:YYYY-MM-DD) and returns the first page of results. Runs in a hidden window by default; pass view: "visible" only when the user wants to see the results on screen.',
  args: z.strictObject({ query: z.string(), ...VIEW_ARG }),
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const q = args.query.trim();
    if (!q) return fail('query is required');
    return withView(ctx, parseView(args), async (view) => {
      const stopped = await navigateStep(view, `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`, signal);
      if (stopped) return stopped;
      return view.callPreload('x_read_visible_posts', { limit: 20 }, signal);
    });
  },
});
