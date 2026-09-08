import { ok, type ToolModule } from '../../../../shared/tools';
import type { PageState } from '../../../../shared/page';
import type { PreloadCtx } from '../../context';
import { pageKindFromUrl } from '../extract';
import { SEL } from '../selectors';
import { findNewPostsButton } from '../widgets';

export function currentPageState(): PageState {
  const url = location.href;
  const kind = pageKindFromUrl(url);
  const healthy = kind === 'other' || kind === 'compose' ? true : !!document.querySelector(SEL.primaryColumn);
  const state: PageState = { url, kind, title: document.title, adapterHealthy: healthy };
  const pill = findNewPostsButton(document);
  if (pill) state.newPostsAvailable = pill.count;
  return state;
}

export const pageState: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_get_page_state',
    description: 'Returns the current x.com URL, page kind (home, post, article, profile, search, likes, compose, other), title, whether the page adapter recognises the layout, and newPostsAvailable when a "Show N posts" pill is on screen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async () => ok(currentPageState()),
};
