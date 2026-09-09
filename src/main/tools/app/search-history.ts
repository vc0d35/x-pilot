import { fail, ok, type ToolModule } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const QUERY_MAX = 200;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 20;

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
        limit: { type: 'integer', minimum: 1, maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
      },
      required: ['query'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  execute: async (args, ctx) => {
    // The search runs synchronously on the main thread, so the declared bounds are enforced here
    // rather than trusted: a long query or a huge limit would otherwise freeze the app.
    const query = String(args.query ?? '').trim().slice(0, QUERY_MAX);
    if (!query) return fail('query is required');
    const limit = Number.isFinite(args.limit) ? Math.min(LIMIT_MAX, Math.max(1, Math.floor(args.limit as number))) : LIMIT_DEFAULT;
    const hits = ctx.history.search({
      query, author: typeof args.author === 'string' ? args.author.replace(/^@/, '') : undefined,
      since: typeof args.since === 'string' ? args.since : undefined, until: typeof args.until === 'string' ? args.until : undefined,
      limit,
    });
    return ok({ total: hits.length, indexedLikes: ctx.history.count(), hits });
  },
};
