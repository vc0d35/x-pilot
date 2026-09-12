import { defineTool, fail, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { sleep, waitFor } from '../dom';
import { extractPost } from '../extract';
import { SEL } from '../selectors';
import { bookmarkInPageDef, likeInPageDef, selectHomeTabDef } from './specs';

const POST_ID = /\/status\/(\d+)/;

/** The count the page shows for a post after a click, so a caller can update its own without a re-read. */
const countOf = (article: Element, key: 'likes' | 'bookmarks'): number | null => extractPost(article)?.stats?.[key] ?? null;

export function findArticleByPostId(root: ParentNode, postId: string): Element | null {
  for (const a of root.querySelectorAll(SEL.article)) if (extractPost(a)?.id === postId) return a;
  return null;
}

/** Internal: clicks like/unlike on a post that is rendered in this page. Main decides whether it may run. */
export const likeInPage = defineTool({
  ...likeInPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const id = POST_ID.exec(args.url)?.[1] ?? args.url;
    const action = args.action ?? 'like';
    let article: Element | null = null;
    try {
      await waitFor(() => (article = findArticleByPostId(document, id)), args.timeoutMs);
    } catch {
      return fail(`Post ${id} is not rendered on this page`);
    }
    const wanted = article!.querySelector<HTMLElement>(action === 'like' ? SEL.likeButton : SEL.unlikeButton);
    if (!wanted) {
      const already = article!.querySelector(action === 'like' ? SEL.unlikeButton : SEL.likeButton);
      return already
        ? ok({ postId: id, liked: action === 'like', changed: false, likes: countOf(article!, 'likes') })
        : fail(`No ${action} button found for post ${id}`);
    }
    wanted.click();
    await sleep(300);
    const nowLiked = !!article!.querySelector(SEL.unlikeButton);
    return ok({ postId: id, liked: nowLiked, changed: nowLiked === (action === 'like'), likes: countOf(article!, 'likes') });
  },
});

/** Internal: bookmarks or unbookmarks a post rendered in this page. Main decides whether it may run. */
export const bookmarkInPage = defineTool({
  ...bookmarkInPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const id = POST_ID.exec(args.url)?.[1] ?? args.url;
    const action = args.action ?? 'bookmark';
    let article: Element | null = null;
    try {
      await waitFor(() => (article = findArticleByPostId(document, id)), args.timeoutMs);
    } catch {
      return fail(`Post ${id} is not rendered on this page`);
    }
    const wanted = article!.querySelector<HTMLElement>(action === 'bookmark' ? SEL.bookmarkButton : SEL.removeBookmarkButton);
    if (!wanted) {
      const already = article!.querySelector(action === 'bookmark' ? SEL.removeBookmarkButton : SEL.bookmarkButton);
      return already
        ? ok({ postId: id, bookmarked: action === 'bookmark', changed: false, bookmarks: countOf(article!, 'bookmarks') })
        : fail(`No ${action} button found for post ${id}`);
    }
    wanted.click();
    await sleep(300);
    const nowBookmarked = !!article!.querySelector(SEL.removeBookmarkButton);
    return ok({
      postId: id,
      bookmarked: nowBookmarked,
      changed: nowBookmarked === (action === 'bookmark'),
      bookmarks: countOf(article!, 'bookmarks'),
    });
  },
});

export const selectHomeTab = defineTool({
  ...selectHomeTabDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const label = args.label.trim().toLowerCase();
    try {
      await waitFor(() => document.querySelector(SEL.homeTab), 8000);
    } catch {
      return fail('No timeline tabs on this page');
    }
    const tab = [...document.querySelectorAll<HTMLElement>(SEL.homeTab)].find((t) => (t.textContent ?? '').trim().toLowerCase() === label);
    if (!tab) return fail(`No tab labelled "${args.label}"`);
    const selected = tab.getAttribute('aria-selected') === 'true';
    if (!selected) {
      tab.click();
      await sleep(800);
    }
    return ok({ label: (tab.textContent ?? '').trim(), changed: !selected });
  },
});
