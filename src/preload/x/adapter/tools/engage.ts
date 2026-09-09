import { fail, ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { extractPost } from '../extract';
import { SEL } from '../selectors';
import { likeInPageSpec, selectHomeTabSpec } from './specs';

const POST_ID = /\/status\/(\d+)/;

export function findArticleByPostId(root: ParentNode, postId: string): Element | null {
  for (const a of root.querySelectorAll(SEL.article)) if (extractPost(a)?.id === postId) return a;
  return null;
}

/** Internal: clicks like/unlike on a post that is rendered in this page. Main decides whether it may run. */
export const likeInPage: ToolModule<PreloadCtx> = {
  spec: likeInPageSpec,
  execute: async (args) => {
    const id = POST_ID.exec(String(args.url ?? ''))?.[1] ?? String(args.url ?? '');
    const action = args.action === 'unlike' ? 'unlike' : 'like';
    let article: Element | null = null;
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
    try { await waitFor(() => (article = findArticleByPostId(document, id)), timeoutMs); } catch { return fail(`Post ${id} is not rendered on this page`); }
    const wanted = article!.querySelector<HTMLElement>(action === 'like' ? SEL.likeButton : SEL.unlikeButton);
    if (!wanted) {
      const already = article!.querySelector(action === 'like' ? SEL.unlikeButton : SEL.likeButton);
      return already ? ok({ postId: id, liked: action === 'like', changed: false }) : fail(`No ${action} button found for post ${id}`);
    }
    wanted.click();
    await sleep(300);
    const nowLiked = !!article!.querySelector(SEL.unlikeButton);
    return ok({ postId: id, liked: nowLiked, changed: nowLiked === (action === 'like') });
  },
};

export const selectHomeTab: ToolModule<PreloadCtx> = {
  spec: selectHomeTabSpec,
  execute: async (args) => {
    const label = String(args.label ?? '').trim().toLowerCase();
    try { await waitFor(() => document.querySelector(SEL.homeTab), 8000); } catch { return fail('No timeline tabs on this page'); }
    const tab = [...document.querySelectorAll<HTMLElement>(SEL.homeTab)].find((t) => (t.textContent ?? '').trim().toLowerCase() === label);
    if (!tab) return fail(`No tab labelled "${args.label}"`);
    const selected = tab.getAttribute('aria-selected') === 'true';
    if (!selected) { tab.click(); await sleep(800); }
    return ok({ label: (tab.textContent ?? '').trim(), changed: !selected });
  },
};
