import type { PageContext } from '../../../shared/page';
import { extractArticle, extractPost, findMainArticle, pageKindFromUrl } from './extract';
import { SEL } from './selectors';

export function computeFocus(doc: Document, url: string): PageContext | null {
  const kind = pageKindFromUrl(url);
  if (kind === 'post' || kind === 'article') {
    const main = findMainArticle(doc, url);
    const post = main ? extractPost(main, url) : null;
    if (!post) return null;
    if (kind === 'article') {
      const a = extractArticle(doc);
      if (a) { post.kind = 'article'; post.articleTitle = a.title; post.articleBody = a.body; }
    }
    return { url, post };
  }
  const dialog = doc.querySelector(SEL.dialog);
  if (dialog && dialog.querySelector(SEL.composerTextarea)) {
    const quoted = dialog.querySelector(SEL.article);
    const post = quoted ? extractPost(quoted, url) : null;
    if (post) return { url, post };
  }
  return null;
}

export function installFocusTracker(doc: Document, getUrl: () => string, send: (ctx: PageContext | null) => void, intervalMs = 1000): () => void {
  let lastId: string | null | undefined; // undefined = never sent
  let lastKey: string | null = null;
  const tick = () => {
    const key = `${getUrl()}|${doc.querySelector(SEL.dialog)?.querySelector(SEL.composerTextarea) ? 'dialog' : ''}`;
    if (key === lastKey && lastId !== null) return;
    lastKey = key;
    const ctx = computeFocus(doc, getUrl());
    const id = ctx?.post.id ?? null;
    if (id === lastId) return;
    lastId = id;
    send(ctx);
  };
  const iv = setInterval(tick, intervalMs);
  return () => clearInterval(iv);
}
