import { ok, type ToolModule } from '../../../../shared/tools';
import type { PageKind, PageState } from '../../../../shared/page';
import type { PreloadCtx } from '../../context';
import { extractArticle, extractVisiblePosts, pageKindFromUrl } from '../extract';
import { waitFor } from '../dom';
import { SEL } from '../selectors';
import { findNewPostsButton } from '../widgets';
import { pageStateSpec } from './specs';

const needsLayout = (kind: PageState['kind']) => kind !== 'other' && kind !== 'compose';

/** Kinds whose whole point is a list of posts, so an empty extraction is a signal, not a state. */
export const TIMELINE_KINDS: ReadonlySet<PageKind> = new Set<PageKind>(['home', 'search', 'profile', 'likes']);

export function computeHealth(kind: PageKind, root: Document = document): PageState['health'] {
  const health: PageState['health'] = { layout: !needsLayout(kind) || !!root.querySelector(SEL.primaryColumn) };
  if (TIMELINE_KINDS.has(kind)) health.posts = extractVisiblePosts(root).length > 0;
  if (kind === 'article') health.article = !!extractArticle(root)?.body;
  return health;
}

export function currentPageState(): PageState {
  const url = location.href;
  const kind = pageKindFromUrl(url);
  const health = computeHealth(kind);
  const state: PageState = { url, kind, title: document.title, adapterHealthy: health.layout && (health.posts ?? true) && (health.article ?? true), health };
  const pill = findNewPostsButton(document);
  if (pill) state.newPostsAvailable = pill.count;
  return state;
}

export const pageState: ToolModule<PreloadCtx> = {
  spec: pageStateSpec,
  execute: async (args) => ok(await settledPageState(typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000)),
};

/**
 * Page state once X has drawn what this kind of page is made of. Right after a navigation the
 * preload is ready before the app has rendered, so judging health at that instant would call a
 * healthy page broken. The waits share one deadline so a broken page cannot stack them.
 */
export async function settledPageState(timeoutMs: number): Promise<PageState> {
  const kind = pageKindFromUrl(location.href);
  const deadline = Date.now() + timeoutMs;
  const left = () => deadline - Date.now();
  const settle = async (check: () => Element | null) => {
    if (left() <= 0) return;
    try { await waitFor(check, left()); } catch { /* report the unhealthy state */ }
  };
  if (timeoutMs > 0) {
    if (needsLayout(kind)) await settle(() => document.querySelector(SEL.primaryColumn));
    if (TIMELINE_KINDS.has(kind)) await settle(() => document.querySelector(SEL.article));
    if (kind === 'article') await settle(() => document.querySelector(SEL.articleView));
  }
  return currentPageState();
}
