import type { PageContext } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import { fenceBlock, fenceLine, pageContentBlock } from '../fence';

/** Caps on page-controlled fields, so one hostile post cannot crowd out the turn. */
const HANDLE_MAX = 64;
const URL_MAX = 512;
const TITLE_MAX = 200;
const TEXT_MAX = 4000;

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
      ]),
    ),
  );
  return `Current page, posts on screen top to bottom:\n${blocks.join('\n')}\n\n${text}`;
}
