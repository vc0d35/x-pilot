import type { PageContext } from './page';

/**
 * Identity of a page context: the focused post, or the ordered posts on screen. The preload uses
 * it to decide whether the focus changed at all; the provider uses it to decide whether a turn
 * needs the full context again. One implementation, so the two can never disagree.
 */
export function contextKey(ctx: PageContext | null | undefined): string | null {
  if (!ctx) return null;
  return ctx.post ? `post:${ctx.post.id}` : `visible:${(ctx.visible ?? []).map((v) => v.id).join(',')}`;
}
