import { fail, type ToolResult } from '../../../shared/tools';
import type { ViewTarget, XViewLike, XViewToolCtx } from './context';

export const VIEW_ARG = {
  view: {
    type: 'string',
    enum: ['background', 'visible'],
    description: 'Where to run: "background" (default) reads in a hidden window and leaves the user\'s screen untouched; "visible" drives the window the user is looking at. Use "visible" only when the user asked to see, open, or browse something.',
  },
} as const;

export function parseView(args: Record<string, unknown>): ViewTarget {
  return args.view === 'visible' ? 'visible' : 'background';
}

/** Resolves the view to drive, converting a background-window failure into a ToolResult. */
export async function pickView(ctx: XViewToolCtx, target: ViewTarget): Promise<XViewLike | ToolResult> {
  if (target === 'visible') return ctx.xview;
  try { return await ctx.background(); }
  catch (err) { return fail(`Background window unavailable: ${err instanceof Error ? err.message : String(err)}`); }
}

export const isToolResult = (v: XViewLike | ToolResult): v is ToolResult => 'success' in v;
