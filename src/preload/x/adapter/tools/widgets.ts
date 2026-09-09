import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { SEL } from '../selectors';
import { extractWidgets, findNewPostsButton } from '../widgets';
import { currentPageState } from './page-state';
import { readWidgetsSpec, showNewPostsSpec } from './specs';

export const readWidgets: ToolModule<PreloadCtx> = {
  spec: readWidgetsSpec,
  execute: async (args) => {
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
    const sel = `${SEL.trend}, ${SEL.newsArticle}`;
    if (timeoutMs > 0) { try { await waitFor(() => document.querySelector(sel), timeoutMs); } catch { /* report whatever is there */ } }
    return ok({ url: location.href, sections: extractWidgets(document) });
  },
};

export const showNewPosts: ToolModule<PreloadCtx> = {
  spec: showNewPostsSpec,
  execute: async () => {
    const hit = findNewPostsButton(document);
    if (!hit) return ok({ shown: false, count: 0, ...currentPageState() });
    hit.button.click();
    await sleep(800);
    return ok({ shown: true, count: hit.count, ...currentPageState() });
  },
};
