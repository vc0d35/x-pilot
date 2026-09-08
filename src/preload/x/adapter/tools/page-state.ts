import { ok, type ToolModule } from '../../../../shared/tools';
import type { PageState } from '../../../../shared/page';
import type { PreloadCtx } from '../../context';
import { pageKindFromUrl } from '../extract';
import { waitFor } from '../dom';
import { SEL } from '../selectors';
import { findNewPostsButton } from '../widgets';

const needsLayout = (kind: PageState['kind']) => kind !== 'other' && kind !== 'compose';

export function currentPageState(): PageState {
  const url = location.href;
  const kind = pageKindFromUrl(url);
  const healthy = !needsLayout(kind) || !!document.querySelector(SEL.primaryColumn);
  const state: PageState = { url, kind, title: document.title, adapterHealthy: healthy };
  const pill = findNewPostsButton(document);
  if (pill) state.newPostsAvailable = pill.count;
  return state;
}

export const pageState: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_get_page_state',
    description: 'Returns the current x.com URL, page kind (home, post, article, profile, search, likes, compose, other), title, whether the page adapter recognises the layout, and newPostsAvailable when a "Show N posts" pill is on screen.',
    inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 0, default: 8000, description: 'How long to wait for the page layout to render before reporting' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args) => ok(await settledPageState(typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000)),
};

/**
 * Page state once X has drawn its layout. Right after a navigation the preload is ready before the
 * app has rendered, so judging health at that instant would call a healthy page broken.
 */
export async function settledPageState(timeoutMs: number): Promise<PageState> {
  if (needsLayout(pageKindFromUrl(location.href)) && timeoutMs > 0) {
    try { await waitFor(() => document.querySelector(SEL.primaryColumn), timeoutMs); } catch { /* report the unhealthy state */ }
  }
  return currentPageState();
}
