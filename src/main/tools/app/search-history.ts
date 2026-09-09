import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const QUERY_MAX = 200;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 20;

export const searchHistory = defineTool({
  name: 'xpilot_search_history',
  description: 'Full-text search over posts the user has LIKED on x.com (text, author, and article body). Use it when the user asks about something they saw, liked, or read before. Returns url, author, snippet, and when it was liked/unliked.',
  args: z.strictObject({
    query: z.string().describe('Free text; each word is a prefix match.'),
    author: z.string().optional().describe('Handle without @'),
    since: z.string().optional().describe('ISO date; only likes on/after'),
    until: z.string().optional().describe('ISO date; only likes on/before'),
    limit: z.int().min(1).max(LIMIT_MAX).default(LIMIT_DEFAULT),
  }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    // The search runs synchronously on the main thread, so an unbounded query is truncated rather
    // than refused: the length was never part of the declared schema.
    const query = args.query.trim().slice(0, QUERY_MAX);
    if (!query) return fail('query is required');
    const hits = ctx.history.search({
      query, author: args.author?.replace(/^@/, ''),
      since: args.since, until: args.until,
      limit: args.limit,
    });
    return ok({ total: hits.length, indexedLikes: ctx.history.count(), hits });
  },
});
