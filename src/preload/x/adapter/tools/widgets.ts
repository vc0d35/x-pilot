import { defineTool, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { SEL } from '../selectors';
import { extractWidgets, findNewPostsButton } from '../widgets';
import { currentPageState } from './page-state';
import { readWidgetsDef, showNewPostsDef } from './specs';

export const readWidgets = defineTool({
  ...readWidgetsDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const sel = `${SEL.trend}, ${SEL.newsArticle}`;
    if (args.timeoutMs > 0) { try { await waitFor(() => document.querySelector(sel), args.timeoutMs); } catch { /* report whatever is there */ } }
    return ok({ url: location.href, sections: extractWidgets(document) });
  },
});

export const showNewPosts = defineTool({
  ...showNewPostsDef,
  execute: async (_args, _ctx: PreloadCtx) => {
    const hit = findNewPostsButton(document);
    if (!hit) return ok({ shown: false, count: 0, ...currentPageState() });
    hit.button.click();
    await sleep(800);
    return ok({ shown: true, count: hit.count, ...currentPageState() });
  },
});
