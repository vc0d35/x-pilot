import { fail, ok, type ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';

export const searchHistory: ToolModule<AppToolCtx> = {
  spec: {
    name: 'xpilot_search_history',
    description: 'Full-text search over posts the user has LIKED on x.com (text, author, and article body). Use it when the user asks about something they saw, liked, or read before. Returns url, author, snippet, and when it was liked/unliked.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text; each word is a prefix match.' },
        author: { type: 'string', description: 'Handle without @' },
        since: { type: 'string', description: 'ISO date; only likes on/after' },
        until: { type: 'string', description: 'ISO date; only likes on/before' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    const query = String(args.query ?? '').trim();
    if (!query) return fail('query is required');
    const hits = ctx.history.search({
      query, author: typeof args.author === 'string' ? args.author.replace(/^@/, '') : undefined,
      since: typeof args.since === 'string' ? args.since : undefined, until: typeof args.until === 'string' ? args.until : undefined,
      limit: typeof args.limit === 'number' ? args.limit : 20,
    });
    return ok({ total: hits.length, indexedLikes: ctx.history.count(), hits });
  },
};
