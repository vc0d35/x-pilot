import { z } from 'zod';
import { defineTool, fail, ok, type ToolResult } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const WHAT_IT_IS =
  'Page styles are the CSS XPilot applies to the x.com page the user is looking at; the hidden windows XPilot reads in are never styled. The file is plain CSS the user can also edit by hand.';

const STYLES_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

export const readPageStyles = defineTool({
  name: 'xpilot_read_page_styles',
  description: `Returns the current page stylesheet. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) => {
    const content: { path: string; css: string; notApplied?: string } = { path: ctx.styles.path, css: ctx.styles.get() };
    if (ctx.styles.lastError) content.notApplied = ctx.styles.lastError;
    return ok(content);
  },
});

/**
 * CSS on the page the user is looking at can cover any control with an invisible one, so a
 * stylesheet the agent wrote is shown to the user before it reaches the page — the same shape as
 * posting. The Settings "Reset" button and the user's own edits to the file are the user acting and
 * are not confirmed.
 */
async function confirmStyles(ctx: AppToolCtx, title: string, detail: string): Promise<ToolResult | null> {
  if (ctx.stylesMode() !== 'confirm') return null;
  const decision = await ctx.approvals.request(
    {
      kind: 'post',
      title,
      detail,
      options: [
        { id: 'apply', label: 'Apply' },
        { id: 'cancel', label: 'Cancel' },
      ],
    },
    STYLES_CONFIRM_TIMEOUT_MS,
  );
  if (decision === 'apply') return null;
  return ok(
    decision === 'timeout'
      ? {
          applied: false,
          status: 'confirmation_timed_out',
          reason: 'The user did not respond to the confirmation within 5 minutes; the page styles were left as they were.',
        }
      : {
          applied: false,
          status: 'cancelled_by_user',
          reason: 'The user read the stylesheet and chose not to apply it; their decision is final.',
        },
  );
}

export const writePageStyles = defineTool({
  name: 'xpilot_write_page_styles',
  description: `Replaces the whole page stylesheet with \`css\`, so read it first when you are changing rules that are already there. Unless the user has set page styles to autonomous, they see the CSS and confirm it before it is applied; a decline comes back as status cancelled_by_user. ${WHAT_IT_IS} A rule may not name a foreign host or an import, and pictures only as data: URIs.`,
  args: z.strictObject({ css: z.string() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    const declined = await confirmStyles(ctx, 'Apply these page styles?', args.css);
    if (declined) return declined;
    const r = ctx.styles.set(args.css);
    return r.ok ? ok(r) : fail(`Rejected: ${r.reason}`);
  },
});

export const resetPageStyles = defineTool({
  name: 'xpilot_reset_page_styles',
  description: `Removes every rule from the page stylesheet, leaving the X page as X ships it. Confirmed the same way xpilot_write_page_styles is. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  annotations: { destructiveHint: true },
  execute: async (_args, ctx: AppToolCtx) => {
    const declined = await confirmStyles(ctx, 'Remove every page style?', ctx.styles.get());
    if (declined) return declined;
    ctx.styles.reset();
    return ok({ ok: true, path: ctx.styles.path });
  },
});
