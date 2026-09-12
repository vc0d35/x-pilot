import { mediaUrl } from '../../../shared/media-url';
import type { LinkCard, Media, PageKind, Post, QuotedPost } from '../../../shared/page';
import { RESERVED_TOP_LEVEL, SEL } from './selectors';

/** Same bound as `PostSchema.text`: a quote is a post, and it is rendered the same way. */
const TEXT_MAX = 20_000;
const CARD_TITLE_MAX = 200;
const ALT_MAX = 1000;
/** X allows four images, and a card or a player is one thing more; the schema allows eight cards. */
const ATTACHMENT_LIMIT = 8;
/** `PostSchema.media`: four pictures is X's own limit, and a player stands where a picture would. */
const MEDIA_LIMIT = 4;

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
  const stats = { replies: 0, reposts: 0, likes: 0, bookmarks: 0, views: 0 };
  // A digit first: a liked post's label carries ", Liked", and a comma read as a number made that 0 likes.
  for (const m of label.matchAll(/(\d[\d,]*)\s+(repl|repost|like|bookmark|view)/gi)) {
    const n = toNumber(m[1]);
    const k = m[2].toLowerCase();
    if (k === 'repl') stats.replies = n;
    else if (k === 'repost') stats.reposts = n;
    else if (k === 'like') stats.likes = n;
    else if (k === 'bookmark') stats.bookmarks = n;
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

/**
 * The article's own first match for `selector`, skipping anything a quoted post brought with it.
 * A quote carries a full post inside the quoting article — its own text, name box and time — so
 * without this the quoted author's words are read as the author's.
 */
function own(article: Element, selector: string): Element | null {
  for (const el of article.querySelectorAll(selector)) if (!el.closest(SEL.quotedPost)) return el;
  return null;
}

function permalinkOf(article: Element): { handle: string; id: string; postedAt: string | null } | null {
  const time = own(article, SEL.permalinkTime) as HTMLTimeElement | null;
  const href = time?.closest('a')?.getAttribute('href') ?? null;
  const m = href ? PERMALINK.exec(href) : null;
  if (!m) return null;
  return { handle: m[1], id: m[2], postedAt: time?.getAttribute('datetime') ?? null };
}

/**
 * Display name only. The `@handle` in the name box is page-written text, so it is never read as
 * identity: the handle always comes from the permalink. Inside a quote the name box holds no
 * links at all, so the plain text blocks are read instead.
 */
function displayNameIn(box: Element | null): string {
  const links = [...(box?.querySelectorAll('a[role="link"]') ?? [])];
  const nodes = links.length > 0 ? links : [...(box?.querySelectorAll('div[dir]') ?? [])];
  for (const n of nodes) {
    const t = (n.textContent ?? '').trim();
    if (t && !t.startsWith('@') && t !== '·') return t;
  }
  return '';
}

const AVATAR_PREFIX = 'UserAvatar-Container-';
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * A quote has no permalink to take the handle from — X renders no `a[href]` inside it — so the
 * name box is tried first and the avatar's test id second. Both are page-written, and both are
 * held to X's handle shape before anything is built out of them.
 */
function quotedHandle(quote: Element): string {
  for (const a of quote.querySelector(SEL.userName)?.querySelectorAll('a[role="link"]') ?? []) {
    const t = (a.textContent ?? '').trim();
    if (t.startsWith('@') && HANDLE.test(t.slice(1))) return t.slice(1);
  }
  const id = quote.querySelector(`[data-testid^="${AVATAR_PREFIX}"]`)?.getAttribute('data-testid')?.slice(AVATAR_PREFIX.length);
  return id && HANDLE.test(id) ? id : '';
}

function extractQuoted(article: Element): QuotedPost | null {
  const quote = article.querySelector(SEL.quotedPost);
  if (!quote) return null;
  return {
    authorHandle: quotedHandle(quote),
    authorName: displayNameIn(quote.querySelector(SEL.userName)),
    text: textWithEmoji(quote.querySelector(SEL.tweetText)).slice(0, TEXT_MAX),
    postedAt: quote.querySelector('time')?.getAttribute('datetime') ?? null,
  };
}

// A card's first line is the site it points at, which the URL already says; the headline is the next one.
const DOMAIN_LINE = /^(?:from\s+)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** The card's text as the lines it renders: its innermost directional blocks, or the whole card. */
function cardLines(card: Element): string[] {
  const lines: string[] = [];
  for (const el of card.querySelectorAll('[dir]')) {
    if (el.querySelector('[dir]')) continue;
    const t = textWithEmoji(el);
    if (t) lines.push(t);
  }
  if (lines.length === 0) {
    const t = textWithEmoji(card);
    if (t) lines.push(t);
  }
  return lines;
}

function extractCards(article: Element): LinkCard[] {
  const out: LinkCard[] = [];
  for (const card of article.querySelectorAll(SEL.linkCard)) {
    if (out.length >= ATTACHMENT_LIMIT) break;
    const a = card.querySelector<HTMLAnchorElement>('a[href]');
    const url = a?.href || a?.getAttribute('href') || '';
    if (!url) continue;
    const lines = cardLines(card);
    const image = mediaUrl(card.querySelector('img')?.getAttribute('src'));
    out.push({
      url: url.slice(0, 512),
      title: (lines.find((l) => !DOMAIN_LINE.test(l)) ?? '').slice(0, CARD_TITLE_MAX),
      ...(image ? { image } : {}),
    });
  }
  return out;
}

const GIF_LABEL = /\bGIF\b/;

/**
 * Whether the player is looping a GIF rather than playing a video. X marks it with no test id of its
 * own: it prints a "GIF" badge over the player and serves the file from its `tweet_video` path, so
 * either is taken as the mark. Only the label rides on this, never what is kept.
 */
function isGif(player: Element, video: Element | null): boolean {
  if (GIF_LABEL.test(player.getAttribute('aria-label') ?? '') || GIF_LABEL.test(video?.getAttribute('aria-label') ?? '')) return true;
  if ([...player.querySelectorAll('span, div')].some((el) => el.textContent?.trim() === 'GIF')) return true;
  return `${video?.getAttribute('poster') ?? ''} ${video?.getAttribute('src') ?? ''}`.includes('tweet_video');
}

/**
 * X serves a video's poster frame from a thumbnail path of its own, and a GIF's from another. Until
 * the player mounts it renders that poster as an ordinary `tweetPhoto`, so the path is what says
 * whether a post attached a picture or a video nobody has pressed play on yet.
 */
const VIDEO_THUMB = /\/(amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//;

function extractMedia(article: Element): Media[] {
  const out: Media[] = [];
  const player = article.querySelector(SEL.videoPlayer);
  for (const img of article.querySelectorAll(SEL.tweetPhoto)) {
    if (out.length >= MEDIA_LIMIT) break;
    // The player's own poster belongs to the player, which is read once, below.
    if (player?.contains(img)) continue;
    const src = img.getAttribute('src') ?? '';
    const url = mediaUrl(src);
    if (VIDEO_THUMB.test(src)) {
      out.push({ kind: src.includes('tweet_video_thumb') ? 'gif' : 'video', ...(url ? { preview: url } : {}) });
      continue;
    }
    // X labels an undescribed image "Image", which tells the model nothing the `kind` does not.
    const alt = (img.getAttribute('alt') ?? '').trim();
    out.push({ kind: 'image', ...(alt && alt !== 'Image' ? { alt: alt.slice(0, ALT_MAX) } : {}), ...(url ? { url } : {}) });
  }
  if (player && out.length < MEDIA_LIMIT) {
    const video = player.querySelector('video');
    // X plays most videos through a MediaSource, whose `src` is a blob: URL of the page's own
    // making: `mediaUrl` drops it, and the poster frame is what is left to show.
    const url = mediaUrl(video?.getAttribute('src'));
    const preview = mediaUrl(video?.getAttribute('poster')) ?? mediaUrl(player.querySelector(SEL.tweetPhoto)?.getAttribute('src'));
    out.push({ kind: isGif(player, video) ? 'gif' : 'video', ...(url ? { url } : {}), ...(preview ? { preview } : {}) });
  }
  return out;
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
  const text = textWithEmoji(own(article, SEL.tweetText));
  const statsLabel = article.querySelector(SEL.statsGroup)?.getAttribute('aria-label') ?? '';
  const cards = extractCards(article);
  const media = extractMedia(article);
  const avatar = mediaUrl(own(article, SEL.authorAvatar)?.getAttribute('src'));
  const liked = own(article, SEL.unlikeButton) ? true : own(article, SEL.likeButton) ? false : undefined;
  const bookmarked = own(article, SEL.removeBookmarkButton) ? true : own(article, SEL.bookmarkButton) ? false : undefined;
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    authorHandle: handle,
    authorName: displayNameIn(own(article, SEL.userName)),
    text,
    postedAt,
    kind: 'post',
    stats: statsLabel ? parseStats(statsLabel) : null,
    quoted: extractQuoted(article),
    ...(liked !== undefined ? { liked } : {}),
    ...(bookmarked !== undefined ? { bookmarked } : {}),
    ...(avatar ? { authorAvatar: avatar } : {}),
    ...(cards.length > 0 ? { cards } : {}),
    ...(media.length > 0 ? { media } : {}),
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
