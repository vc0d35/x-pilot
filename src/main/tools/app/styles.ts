import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const WHAT_IT_IS =
  'Page styles are the CSS XPilot applies to the x.com page the user is looking at; the hidden windows XPilot reads in are never styled. The file is plain CSS the user can also edit by hand.';

export const readPageStyles = defineTool({
  name: 'xpilot_read_page_styles',
  description: `Returns the current page stylesheet. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) => ok({ path: ctx.styles.path, css: ctx.styles.get() }),
});

export const writePageStyles = defineTool({
  name: 'xpilot_write_page_styles',
  description: `Replaces the whole page stylesheet with \`css\`, applied to the page at once, so read it first when you are changing rules that are already there. ${WHAT_IT_IS} url() may only reference a data: URI and @import is rejected.`,
  args: z.strictObject({ css: z.string() }),
  execute: async (args, ctx: AppToolCtx) => {
    const r = ctx.styles.set(args.css);
    return r.ok ? ok(r) : fail(`Rejected: ${r.reason}`);
  },
});

export const resetPageStyles = defineTool({
  name: 'xpilot_reset_page_styles',
  description: `Removes every rule from the page stylesheet, leaving the X page as X ships it. ${WHAT_IT_IS}`,
  args: z.strictObject({}),
  execute: async (_args, ctx: AppToolCtx) => {
    ctx.styles.reset();
    return ok({ ok: true, path: ctx.styles.path });
  },
});
