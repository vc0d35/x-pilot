import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { waitFor } from '../dom';
import { extractVisiblePosts, pageKindFromUrl } from '../extract';
import { SEL } from '../selectors';
import { TIMELINE_KINDS } from './page-state';
import { readVisiblePostsSpec } from './specs';

export const NO_POSTS_WARNING = 'No posts found; X may have changed its markup';

export const readVisiblePosts: ToolModule<PreloadCtx> = {
  spec: readVisiblePostsSpec,
  execute: async (args) => {
    try { await waitFor(() => document.querySelector(SEL.article), 8000); } catch { /* fall through with whatever is there */ }
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const posts = extractVisiblePosts(document).slice(0, limit);
    const suspect = posts.length === 0 && TIMELINE_KINDS.has(pageKindFromUrl(location.href));
    return ok(posts, suspect ? NO_POSTS_WARNING : undefined);
  },
};
