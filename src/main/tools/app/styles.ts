import { z } from 'zod';
import { defineTool, fail, ok, type ToolResult } from '../../../shared/tools';
import { validateCss } from '../../page-config/styles';
import type { ApprovalOption } from '../../../shared/agent';
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
 * stylesheet the agent wrote is put on the page as a preview and shown to the user before it is
 * written to the file. The preview comes off however this ends — kept, adjusted, reverted, timed
 * out, or the turn dying mid-question — which is what the `finally` is for. The Settings "Reset"
 * button and the user's own edits to the file are the user acting and are not confirmed.
 */
async function previewAndAsk(
  ctx: AppToolCtx,
  opts: { title: string; detail: string; preview: string | null; adjustable: boolean },
): Promise<ToolResult | null> {
  ctx.styles.preview(opts.preview);
  try {
    const options: ApprovalOption[] = [
      { id: 'keep', label: 'Keep' },
      ...(opts.adjustable ? [{ id: 'adjust', label: 'Adjust…', note: true }] : []),
      { id: 'revert', label: 'Revert' },
    ];
    const { decision, note } = await ctx.approvals.request(
      { kind: 'post', title: opts.title, detail: opts.detail, options },
      STYLES_CONFIRM_TIMEOUT_MS,
    );
    if (decision === 'keep') return null;
    if (decision === 'adjust')
      return ok({
        status: 'adjust_requested',
        note: note ?? '',
        reason: 'The user previewed the styles and wants a change; apply the note and propose again.',
      });
    return ok(
      decision === 'timeout'
        ? {
            status: 'confirmation_timed_out',
            reason: 'The user did not answer within 5 minutes; the preview was taken off and the stylesheet was left as it was.',
          }
        : {
            status: 'cancelled_by_user',
            reason: 'The user saw the styles on the page and chose to revert them; their decision is final.',
          },
    );
  } finally {
    ctx.styles.preview(null);
  }
}

export const writePageStyles = defineTool({
  name: 'xpilot_write_page_styles',
  description: `Replaces the whole page stylesheet with \`css\`, so read it first when you are changing rules that are already there. Unless the user has set page styles to autonomous they see the CSS on the page as a preview and decide: status kept means it was written, adjust_requested carries a note saying what to change, cancelled_by_user means they reverted it. ${WHAT_IT_IS} A rule may not name a foreign host or an import, and pictures only as data: URIs.`,
  args: z.strictObject({ css: z.string() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) => {
    // Checked before the preview, not just before the write: nothing that would be refused on its
    // way to the file is put on the user's page to be judged.
    const invalid = validateCss(args.css);
    if (invalid) return fail(`Rejected: ${invalid}`);
    if (ctx.stylesMode() === 'confirm') {
      const answered = await previewAndAsk(ctx, {
        title: 'Keep these page styles?',
        detail: args.css,
        preview: args.css,
        adjustable: true,
      });
      if (answered) return answered;
    }
    const r = ctx.styles.set(args.css);
    return r.ok ? ok({ status: 'kept', bytes: r.bytes }) : fail(`Rejected: ${r.reason}`);
  },
});

export const resetPageStyles = defineTool({
  name: 'xpilot_reset_page_styles',
  description: `Removes every rule from the page stylesheet, leaving the X page as X ships it. Confirmed the same way xpilot_write_page_styles is, without the preview: taking rules away is not something a layered sheet can show. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  annotations: { destructiveHint: true },
  execute: async (_args, ctx: AppToolCtx) => {
    if (ctx.stylesMode() === 'confirm') {
      // A preview layers a sheet over the file's; it cannot show the absence of one, so the card
      // for a reset shows the CSS that would go and leaves the page as it is until the user says.
      const answered = await previewAndAsk(ctx, {
        title: 'Remove every page style?',
        detail: ctx.styles.get(),
        preview: null,
        adjustable: false,
      });
      if (answered) return answered;
    }
    ctx.styles.reset();
    return ok({ status: 'kept', path: ctx.styles.path });
  },
});
