import { fail, type ToolModule } from '../../../shared/tools';
import type { XViewToolCtx } from './context';

export const search: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_search',
    description: 'Runs an x.com search (supports X search operators like from:user, since:YYYY-MM-DD) and returns the first page of results.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  execute: async (args, ctx) => {
    const q = String(args.query ?? '').trim();
    if (!q) return fail('query is required');
    await ctx.xview.navigate(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`);
    return ctx.xview.callPreload('x_read_visible_posts', { limit: 20 });
  },
};
