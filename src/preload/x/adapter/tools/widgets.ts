import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { SEL } from '../selectors';
import { extractWidgets, findNewPostsButton } from '../widgets';
import { currentPageState } from './page-state';

export const readWidgets: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_read_widgets',
    description: 'Internal: read the "What\'s happening" trends and "Today\'s News" headlines rendered in this window.',
    inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 0, default: 8000 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, internal: true },
  },
  execute: async (args) => {
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
    const sel = `${SEL.trend}, ${SEL.newsArticle}`;
    if (timeoutMs > 0) { try { await waitFor(() => document.querySelector(sel), timeoutMs); } catch { /* report whatever is there */ } }
    return ok({ url: location.href, sections: extractWidgets(document) });
  },
};

export const showNewPosts: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_show_new_posts',
    description: 'Clicks the "Show N posts" pill that X puts at the top of the timeline in the window the user is looking at when new posts have arrived, so they load on screen. Returns shown: false when there is no pill. x_get_page_state and x_scroll report newPostsAvailable when one is present.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  execute: async () => {
    const hit = findNewPostsButton(document);
    if (!hit) return ok({ shown: false, count: 0, ...currentPageState() });
    hit.button.click();
    await sleep(800);
    return ok({ shown: true, count: hit.count, ...currentPageState() });
  },
};
