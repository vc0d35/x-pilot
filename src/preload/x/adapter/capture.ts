import { IPC } from '../../../shared/ipc';
import { extractArticle, extractPost, pageKindFromUrl } from './extract';
import { SEL } from './selectors';

/** Captures like/unlike clicks (capture phase, so X's own handlers can't swallow them). */
export function installLikeCapture(doc: Document, getUrl: () => string, send: (channel: string, payload: unknown) => void): () => void {
  const handler = (ev: Event) => {
    const target = ev.target as Element | null;
    const btn = target?.closest?.(`${SEL.likeButton}, ${SEL.unlikeButton}`) as HTMLElement | null;
    if (!btn) return;
    const article = btn.closest(SEL.article);
    if (!article) return;
    const url = getUrl();
    const post = extractPost(article, url);
    if (!post) return;
    const now = new Date().toISOString();
    if (btn.dataset.testid === 'unlike') { send(IPC.historyUnliked, { id: post.id, at: now }); return; }
    if (pageKindFromUrl(url) === 'article') {
      const a = extractArticle(doc);
      if (a) { post.kind = 'article'; post.articleTitle = a.title; post.articleBody = a.body; }
    }
    send(IPC.historyLiked, { post, likedAt: now });
  };
  doc.addEventListener('click', handler, true);
  return () => doc.removeEventListener('click', handler, true);
}
