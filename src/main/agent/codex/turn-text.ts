import type { LinkCard, Media, PageContext, QuotedPost } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import { fenceBlock, fenceLine, pageContentBlock } from '../fence';

/** Caps on page-controlled fields, so one hostile post cannot crowd out the turn. */
const HANDLE_MAX = 64;
const URL_MAX = 512;
const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const ALT_MAX = 200;

/** The quote is another author's post carried inside this one, so it is labelled and blocked off on its own. */
function quotedLines(quoted: QuotedPost): string[] {
  const lines = ['', `quoted post by @${fenceLine(quoted.authorHandle, HANDLE_MAX)}:`];
  if (quoted.text) lines.push(fenceBlock(quoted.text, TEXT_MAX));
  return lines;
}

function attachmentLines(cards: LinkCard[] | undefined, media: Media[] | undefined): string[] {
  const lines: string[] = [];
  for (const c of cards ?? []) {
    const title = fenceLine(c.title, TITLE_MAX);
    lines.push(`link: ${title ? `${title} ` : ''}${fenceLine(c.url, URL_MAX)}`);
  }
  // The hint says what is attached, not where it lives: a post's media URLs are long, they buy the
  // model nothing it can see, and the read tools carry them for anything that actually renders one.
  for (const m of media ?? []) lines.push(`media: ${fenceLine(m.kind, 16)}${m.alt ? ` "${fenceLine(m.alt, ALT_MAX)}"` : ''}`);
  return lines;
}

/**
 * The page controls every field below, identity included, so all of them go inside the fence:
 * the only lines outside it are ours.
 */
export function buildTurnText(text: string, ctx: PageContext | null | undefined, lastKey: string | null): string {
  if (!ctx) return text;
  const unchanged = lastKey === contextKey(ctx);
  const p = ctx.post;
  if (p) {
    const author = p.authorName
      ? `@${fenceLine(p.authorHandle, HANDLE_MAX)} (${fenceLine(p.authorName, HANDLE_MAX)})`
      : `@${fenceLine(p.authorHandle, HANDLE_MAX)}`;
    const head = `${fenceLine(p.kind, HANDLE_MAX)} by ${author} at ${fenceLine(p.url, URL_MAX)}`;
    if (unchanged) return `Current page, unchanged since the last turn:\n${pageContentBlock([head])}\n\n${text}`;
    const lines = [head];
    if (p.articleTitle) lines.push(`Title: ${fenceLine(p.articleTitle, TITLE_MAX)}`);
    if (p.text) lines.push(fenceBlock(p.text, TEXT_MAX));
    if (p.quoted) lines.push(...quotedLines(p.quoted));
    lines.push(...attachmentLines(p.cards, p.media));
    if (p.articleBody) lines.push('', fenceBlock(p.articleBody, TEXT_MAX));
    return `Current page:\n${pageContentBlock(lines)}\n\n${text}`;
  }
  const visible = ctx.visible ?? [];
  if (visible.length === 0) return text;
  const view = `view: ${fenceLine(ctx.kind, HANDLE_MAX)} at ${fenceLine(ctx.url, URL_MAX)}`;
  if (unchanged) return `Current page, unchanged since the last turn:\n${pageContentBlock([view])}\n\n${text}`;
  const blocks = [pageContentBlock([view])];
  visible.forEach((v, i) =>
    blocks.push(
      pageContentBlock([
        `${i + 1}. @${fenceLine(v.authorHandle, HANDLE_MAX)} — ${fenceLine(v.url, URL_MAX)}`,
        fenceBlock(v.text, TEXT_MAX),
        ...(v.quoted ? quotedLines({ ...v.quoted, authorName: '', postedAt: null }) : []),
      ]),
    ),
  );
  return `Current page, posts on screen top to bottom:\n${blocks.join('\n')}\n\n${text}`;
}
