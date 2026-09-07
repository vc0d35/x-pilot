import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { waitFor } from '../dom';
import { extractVisiblePosts } from '../extract';
import { SEL } from '../selectors';

export const readVisiblePosts: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_read_visible_posts',
    description: 'Reads the posts currently rendered on the page (timeline, search results, profile, likes). Returns id, url, author, text, time and stats. Use x_scroll to load more.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args) => {
    try { await waitFor(() => document.querySelector(SEL.article), 8000); } catch { /* fall through with whatever is there */ }
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    return ok(extractVisiblePosts(document).slice(0, limit));
  },
};
