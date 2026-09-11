import type { LinkCard, Media, PageContext, QuotedPost } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import {
  VIEW_STATE_EXTRA_KEY_MAX,
  VIEW_STATE_EXTRA_VALUE_MAX,
  VIEW_STATE_FOCUS_TEXT_MAX,
  VIEW_STATE_ITEM_TEXT_MAX,
  VIEW_STATE_SUMMARY_MAX,
  type ActiveViewState,
} from '../../../shared/views';
import { fenceBlock, fenceLine, pageContentBlock } from '../fence';

/** Caps on page-controlled fields, so one hostile post cannot crowd out the turn. */
const HANDLE_MAX = 64;
const URL_MAX = 512;
const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const ALT_MAX = 200;
/** A view name is a folder name the store validated, but it is rendered like everything else here. */
const VIEW_NAME_MAX = 40;

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
 * The X page, as the hint says it. `label` is what it is called: "Current page" normally, and the
 * page underneath when a custom view is the thing the user is actually looking at. Returns null when
 * there is nothing worth saying.
 */
function pageLines(ctx: PageContext, lastKey: string | null, label: string): string | null {
  const unchanged = lastKey === contextKey(ctx);
  const p = ctx.post;
  if (p) {
    const author = p.authorName
      ? `@${fenceLine(p.authorHandle, HANDLE_MAX)} (${fenceLine(p.authorName, HANDLE_MAX)})`
      : `@${fenceLine(p.authorHandle, HANDLE_MAX)}`;
    const head = `${fenceLine(p.kind, HANDLE_MAX)} by ${author} at ${fenceLine(p.url, URL_MAX)}`;
    if (unchanged) return `${label}, unchanged since the last turn:\n${pageContentBlock([head])}`;
    const lines = [head];
    if (p.articleTitle) lines.push(`Title: ${fenceLine(p.articleTitle, TITLE_MAX)}`);
    if (p.text) lines.push(fenceBlock(p.text, TEXT_MAX));
    if (p.quoted) lines.push(...quotedLines(p.quoted));
    lines.push(...attachmentLines(p.cards, p.media));
    if (p.articleBody) lines.push('', fenceBlock(p.articleBody, TEXT_MAX));
    return `${label}:\n${pageContentBlock(lines)}`;
  }
  const visible = ctx.visible ?? [];
  if (visible.length === 0) return null;
  const view = `view: ${fenceLine(ctx.kind, HANDLE_MAX)} at ${fenceLine(ctx.url, URL_MAX)}`;
  if (unchanged) return `${label}, unchanged since the last turn:\n${pageContentBlock([view])}`;
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
  return `${label}, posts on screen top to bottom:\n${blocks.join('\n')}`;
}

/** `@handle: text (url)`, with whatever of the three the view actually published. */
function focusLine(focus: NonNullable<ActiveViewState['state']>['focus'], textMax: number): string {
  if (focus === null) return 'focused: nothing';
  if (!focus) return '';
  const parts: string[] = [];
  if (focus.authorHandle) parts.push(`@${fenceLine(focus.authorHandle, HANDLE_MAX)}:`);
  if (focus.text) parts.push(fenceLine(focus.text, textMax));
  if (focus.url) parts.push(`(${fenceLine(focus.url, URL_MAX)})`);
  return `focused: ${parts.length ? parts.join(' ') : 'something the view did not describe'}`;
}

/**
 * The custom view on the user's screen. Everything in the block is written by the view — which is
 * agent-written code fed by an untrusted page — so all of it goes inside one fence, the view's own
 * name included.
 */
function viewLines(active: ActiveViewState): string {
  const name = fenceLine(active.view, VIEW_NAME_MAX);
  const state = active.state;
  const summary = state?.summary ? `: ${fenceLine(state.summary, VIEW_STATE_SUMMARY_MAX)}` : '';
  const lines = [`Custom view "${name}" is on the user's screen${summary || '.'}`];
  const focus = focusLine(state?.focus, VIEW_STATE_FOCUS_TEXT_MAX);
  if (focus) lines.push(focus);
  const items = state?.items ?? [];
  if (items.length) {
    lines.push('items:');
    items.forEach((item, i) => {
      const who = item.authorHandle ? `@${fenceLine(item.authorHandle, HANDLE_MAX)} — ` : '';
      const url = item.url ? ` (${fenceLine(item.url, URL_MAX)})` : '';
      lines.push(`${i + 1}. ${who}${fenceLine(item.text ?? '', VIEW_STATE_ITEM_TEXT_MAX)}${url}`);
    });
  }
  const extra = Object.entries(state?.extra ?? {});
  if (extra.length)
    lines.push(
      `extra: ${extra.map(([k, v]) => `${fenceLine(k, VIEW_STATE_EXTRA_KEY_MAX)}=${fenceLine(v, VIEW_STATE_EXTRA_VALUE_MAX)}`).join('; ')}`,
    );
  return `Custom view on screen:\n${pageContentBlock(lines)}`;
}

/**
 * The page controls every field below, identity included, so all of them go inside the fence:
 * the only lines outside it are ours. A custom view leads, when one is up — it is what the user is
 * looking at — and the X page follows it as the page underneath.
 */
export function buildTurnText(
  text: string,
  ctx: PageContext | null | undefined,
  lastKey: string | null,
  activeView?: ActiveViewState | null,
): string {
  const page = ctx ? pageLines(ctx, lastKey, activeView ? 'The X page underneath' : 'Current page') : null;
  if (!activeView) return page ? `${page}\n\n${text}` : text;
  return [viewLines(activeView), ...(page ? [page] : []), text].join('\n\n');
}
