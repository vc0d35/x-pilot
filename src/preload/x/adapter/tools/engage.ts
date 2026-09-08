import { fail, ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { extractPost } from '../extract';
import { SEL } from '../selectors';

const POST_ID = /\/status\/(\d+)/;

/** Finds the rendered article for a post id (timeline card or the main post on its page). */
export function findArticleByPostId(root: ParentNode, postId: string): Element | null {
  for (const a of root.querySelectorAll(SEL.article)) if (extractPost(a)?.id === postId) return a;
  return null;
}

/** Internal: clicks like/unlike on a post that is rendered in this page. Main decides whether it may run. */
export const likeInPage: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_like_in_page',
    description: 'Internal: like or unlike a post rendered in this window by post URL or id.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, action: { type: 'string', enum: ['like', 'unlike'] }, timeoutMs: { type: 'integer', default: 8000 } }, required: ['url'], additionalProperties: false },
    annotations: { destructiveHint: true, internal: true },
  },
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

/** Internal: selects a Home timeline tab ("For you" / "Following") by its label. */
export const selectHomeTab: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_select_home_tab',
    description: 'Internal: click the Home tab whose label matches (e.g. "For you", "Following").',
    inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
    annotations: { internal: true },
  },
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
