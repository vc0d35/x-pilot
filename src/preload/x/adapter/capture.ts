import { IPC } from '../../../shared/ipc';
import { extractArticle, extractPost, pageKindFromUrl } from './extract';
import { SEL } from './selectors';

interface PointerSnapshot { btn: HTMLElement; action: 'like' | 'unlike'; article: Element }

/** Captures like/unlike clicks (capture phase, so X's own handlers can't swallow them). */
export function installLikeCapture(doc: Document, getUrl: () => string, send: (channel: string, payload: unknown) => void): () => void {
  // X sometimes optimistically re-renders (swaps the element / flips data-testid) between
  // pointerdown and click. Snapshot the button's action on pointerdown so a real like isn't
  // misread as an unlike once the click handler runs against the mutated DOM.
  let snapshot: PointerSnapshot | null = null;

  const onPointerDown = (ev: Event) => {
    // Page script can dispatch like/unlike events at will; only a real user gesture may write history.
    if (!ev.isTrusted) return;
    const target = ev.target as Element | null;
    const btn = target?.closest?.(`${SEL.likeButton}, ${SEL.unlikeButton}`) as HTMLElement | null;
    if (!btn) { snapshot = null; return; }
    const article = btn.closest(SEL.article);
    if (!article) { snapshot = null; return; }
    snapshot = { btn, action: btn.dataset.testid === 'unlike' ? 'unlike' : 'like', article };
  };

  const handler = (ev: Event) => {
    if (!ev.isTrusted) return;
    const target = ev.target as Element | null;
    const btn = target?.closest?.(`${SEL.likeButton}, ${SEL.unlikeButton}`) as HTMLElement | null;
    if (!btn) { snapshot = null; return; }
    const article = btn.closest(SEL.article);
    if (!article) { snapshot = null; return; }
    const url = getUrl();
    const post = extractPost(article, url);
    if (!post) { snapshot = null; return; }
    const now = new Date().toISOString();
    // Keyboard activation (Enter/Space) fires click without a preceding pointerdown, so there's
    // no snapshot to distrust the live DOM read for; use it as-is in that case.
    const action: 'like' | 'unlike' = (snapshot && (snapshot.article === article || snapshot.article.contains(article)))
      ? snapshot.action
      : (btn.dataset.testid === 'unlike' ? 'unlike' : 'like');
    snapshot = null;
    if (action === 'unlike') { send(IPC.historyUnliked, { id: post.id, at: now }); return; }
    if (pageKindFromUrl(url) === 'article') {
      const a = extractArticle(doc);
      if (a) { post.kind = 'article'; post.articleTitle = a.title; post.articleBody = a.body; }
    }
    send(IPC.historyLiked, { post, likedAt: now });
  };

  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('click', handler, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('click', handler, true);
  };
}
