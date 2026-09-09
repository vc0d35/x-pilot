import type { PageKind, Post } from '../../../shared/page';
import { RESERVED_TOP_LEVEL, SEL } from './selectors';

export function pageKindFromUrl(url: string): PageKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'other';
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'home') return 'home';
  if (parts[0] === 'search') return 'search';
  if (parts[0] === 'compose' || parts[0] === 'intent') return 'compose';
  if (parts[0] === 'i' && parts[1] === 'article') return 'article';
  if (parts[0] === 'i' && parts[1] === 'bookmarks') return 'bookmarks';
  if (parts.length >= 3 && parts[1] === 'article') return 'article';
  if (parts.length >= 3 && parts[1] === 'status') return 'post';
  if (parts.length === 2 && parts[1] === 'likes') return 'likes';
  if (parts.length === 1 && !RESERVED_TOP_LEVEL.has(parts[0])) return 'profile';
  return 'other';
}

export function textWithEmoji(el: Element | null): string {
  if (!el) return '';
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (e.tagName === 'IMG') {
      out += e.getAttribute('alt') ?? '';
      return;
    }
    if (e.tagName === 'BR') {
      out += '\n';
      return;
    }
    for (const c of e.childNodes) walk(c);
  };
  walk(el);
  return out.trim();
}

const toNumber = (s: string) => Number(s.replace(/,/g, '')) || 0;

export function parseStats(label: string): NonNullable<Post['stats']> {
  const stats = { replies: 0, reposts: 0, likes: 0, views: 0 };
  for (const m of label.matchAll(/([\d,]+)\s+(repl|repost|like|view)/gi)) {
    const n = toNumber(m[1]);
    const k = m[2].toLowerCase();
    if (k === 'repl') stats.replies = n;
    else if (k === 'repost') stats.reposts = n;
    else if (k === 'like') stats.likes = n;
    else stats.views = n;
  }
  return stats;
}

// Handles are page-controlled, and the match is used to rebuild a URL: only X's own handle shape is
// accepted, and the id must end the segment, so `\n` and lookalike paths cannot ride along.
const PERMALINK = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#]|$)/;
// `i` is X's reserved namespace, so it must not be read as a handle: try it first.
const ARTICLE_PERMALINK = /^\/(?:i\/article|([A-Za-z0-9_]{1,15})\/article)\/(\d{1,25})(?:[/?#]|$)/;

/** Fallback for X Article pages that render no `article[data-testid="tweet"]`: synthesises the post from the URL alone. */
export function postFromArticleUrl(url: string, title = ''): Post | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = ARTICLE_PERMALINK.exec(path);
  if (!m) return null;
  const handle = m[1] ?? '';
  const id = m[2];
  return {
    id,
    url: handle ? `https://x.com/${handle}/article/${id}` : `https://x.com/i/article/${id}`,
    authorHandle: handle,
    authorName: '',
    text: title,
    postedAt: null,
    kind: 'article',
    stats: null,
  };
}

function permalinkOf(article: Element): { handle: string; id: string; postedAt: string | null } | null {
  const time = article.querySelector<HTMLTimeElement>(SEL.permalinkTime);
  const href = time?.closest('a')?.getAttribute('href') ?? null;
  const m = href ? PERMALINK.exec(href) : null;
  if (!m) return null;
  return { handle: m[1], id: m[2], postedAt: time?.getAttribute('datetime') ?? null };
}

/**
 * Display name only. The `@handle` in the name box is page-written text, so it is never read as
 * identity: the handle always comes from the permalink.
 */
function displayNameOf(article: Element): string {
  const box = article.querySelector(SEL.userName);
  for (const a of box?.querySelectorAll('a[role="link"]') ?? []) {
    const t = (a.textContent ?? '').trim();
    if (t && !t.startsWith('@')) return t;
  }
  return '';
}

/**
 * Whether the element is actually shown to the user. jsdom (tests) has no layout engine at all, so
 * nothing ever reports geometry there; fall back to the styles it does resolve.
 */
export function isRendered(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.getClientRects?.().length) return true;
  if (h.offsetParent) return true;
  const doc = el.ownerDocument;
  if (doc.documentElement.getClientRects?.().length) return false;
  const view = doc.defaultView;
  if (!view) return true;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const style = view.getComputedStyle(n);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function extractPost(article: Element, fallbackUrl?: string): Post | null {
  const link = permalinkOf(article);
  let id: string;
  let handle: string;
  let postedAt: string | null;
  if (link) {
    id = link.id;
    handle = link.handle;
    postedAt = link.postedAt;
  } else {
    const m = fallbackUrl ? PERMALINK.exec(new URL(fallbackUrl).pathname) : null;
    if (!m) return null;
    handle = m[1];
    id = m[2];
    postedAt = null;
  }
  const text = textWithEmoji(article.querySelector(SEL.tweetText));
  const statsLabel = article.querySelector(SEL.statsGroup)?.getAttribute('aria-label') ?? '';
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    authorHandle: handle,
    authorName: displayNameOf(article),
    text,
    postedAt,
    kind: 'post',
    stats: statsLabel ? parseStats(statsLabel) : null,
  };
}

export function extractVisiblePosts(root: ParentNode): Post[] {
  const seen = new Set<string>();
  const out: Post[] = [];
  for (const a of root.querySelectorAll(SEL.article)) {
    const p = extractPost(a);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/**
 * On a status page, the main article is the rendered one whose permalink id equals the page id — and
 * nothing else, so an injected article cannot stand in for the post the user opened.
 */
export function findMainArticle(root: ParentNode, url: string): Element | null {
  const articles = [...root.querySelectorAll(SEL.article)].filter(isRendered);
  if (articles.length === 0) return null;
  const m = PERMALINK.exec(new URL(url).pathname);
  if (m) return articles.find((a) => permalinkOf(a)?.id === m[2]) ?? null;
  return articles[0];
}

/** Consecutive articles after `main` by the same author (the author's own thread). */
export function extractThread(root: ParentNode, main: Element, authorHandle: string): Post[] {
  const articles = [...root.querySelectorAll(SEL.article)];
  const start = articles.indexOf(main);
  const out: Post[] = [];
  for (const a of articles.slice(start + 1)) {
    const p = extractPost(a);
    if (!p || p.authorHandle !== authorHandle) break;
    out.push(p);
  }
  return out;
}

export function extractArticle(root: ParentNode): { title: string; body: string } | null {
  const view = root.querySelector(SEL.articleView);
  if (!view) return null;
  const title = (root.querySelector(SEL.articleTitle)?.textContent ?? root.querySelector('h1')?.textContent ?? '').trim();
  const body = root.querySelector(SEL.articleBody) ?? view;
  return { title, body: textWithEmoji(body) };
}

export function extractComposer(root: ParentNode): { present: boolean; text: string; canSubmit: boolean } {
  const ta = root.querySelector(SEL.composerTextarea);
  if (!ta) return { present: false, text: '', canSubmit: false };
  const btn = root.querySelector<HTMLButtonElement>(SEL.postButton);
  const disabled = !btn || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
  return { present: true, text: textWithEmoji(ta), canSubmit: !disabled };
}
