import { ok, type ToolModule } from '../../../../shared/tools';
import type { PageState } from '../../../../shared/page';
import type { PreloadCtx } from '../../context';
import { pageKindFromUrl } from '../extract';
import { SEL } from '../selectors';

export function currentPageState(): PageState {
  const url = location.href;
  const kind = pageKindFromUrl(url);
  const healthy = kind === 'other' || kind === 'compose' ? true : !!document.querySelector(SEL.primaryColumn);
  return { url, kind, title: document.title, adapterHealthy: healthy };
}

export const pageState: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_get_page_state',
    description: 'Returns the current x.com URL, page kind (home, post, article, profile, search, likes, compose, other), title, and whether the page adapter recognises the layout.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async () => ok(currentPageState()),
};
