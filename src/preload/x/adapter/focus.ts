import type { PageContext, VisiblePost } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import { extractArticle, extractPost, findMainArticle, pageKindFromUrl, postFromArticleUrl } from './extract';
import { SEL } from './selectors';

export type InViewport = (el: Element) => boolean;
const VISIBLE_LIMIT = 8;
const EXCERPT = 160;
/** `VisiblePostSchema`'s cap on a quote: enough to know what is being quoted, small enough for a hint. */
const QUOTE_EXCERPT = 280;

export const inViewport: InViewport = (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0;
};

export function visiblePosts(doc: Document, isVisible: InViewport): VisiblePost[] {
  const out: VisiblePost[] = [];
  for (const article of doc.querySelectorAll(SEL.article)) {
    if (out.length >= VISIBLE_LIMIT) break;
    if (!isVisible(article)) continue;
    const p = extractPost(article);
    if (p && !out.some((v) => v.id === p.id))
      out.push({
        id: p.id,
        url: p.url,
        authorHandle: p.authorHandle,
        text: p.text.slice(0, EXCERPT),
        ...(p.quoted ? { quoted: { authorHandle: p.quoted.authorHandle, text: p.quoted.text.slice(0, QUOTE_EXCERPT) } } : {}),
      });
  }
  return out;
}

export function computeFocus(doc: Document, url: string, isVisible: InViewport = inViewport): PageContext | null {
  const kind = pageKindFromUrl(url);
  if (kind === 'post' || kind === 'article') {
    const main = findMainArticle(doc, url);
    const a = kind === 'article' ? extractArticle(doc) : null;
    // An article page may render only the reader view; synthesise the post from the URL then.
    const post = (main ? extractPost(main, url) : null) ?? (kind === 'article' ? postFromArticleUrl(url, a?.title ?? '') : null);
    if (!post) return null;
    if (a) {
      post.kind = 'article';
      post.articleTitle = a.title;
      post.articleBody = a.body;
    }
    return { url, kind, post };
  }
  const dialog = doc.querySelector(SEL.dialog);
  if (dialog && dialog.querySelector(SEL.composerTextarea)) {
    const quoted = dialog.querySelector(SEL.article);
    const post = quoted ? extractPost(quoted, url) : null;
    if (post) return { url, kind, post };
  }
  const visible = visiblePosts(doc, isVisible);
  return visible.length ? { url, kind, post: null, visible } : null;
}

export function installFocusTracker(
  doc: Document,
  getUrl: () => string,
  send: (ctx: PageContext | null) => void,
  intervalMs = 1000,
  isVisible: InViewport = inViewport,
): () => void {
  let lastSig: string | null | undefined; // undefined = never sent
  let lastKey: string | null = null;
  const tick = () => {
    const url = getUrl();
    const kind = pageKindFromUrl(url);
    const key = `${url}|${doc.querySelector(SEL.dialog)?.querySelector(SEL.composerTextarea) ? 'dialog' : ''}`;
    // Post/article pages: the focus cannot change without the URL or a dialog changing, so skip the DOM walk.
    const focusedPage = kind === 'post' || kind === 'article';
    if (focusedPage && key === lastKey && lastSig) return;
    lastKey = key;
    const ctx = computeFocus(doc, url, isVisible);
    const sig = contextKey(ctx);
    if (sig === lastSig) return;
    lastSig = sig;
    send(ctx);
  };
  const iv = setInterval(tick, intervalMs);
  return () => clearInterval(iv);
}
