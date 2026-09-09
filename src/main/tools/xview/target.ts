import { fail, type ToolResult } from '../../../shared/tools';
import type { ViewTarget, XViewLike, XViewToolCtx } from './context';

export const VIEW_ARG = {
  view: {
    type: 'string',
    enum: ['background', 'visible'],
    description: 'Where to run: "background" (default) reads in a hidden window and leaves the user\'s screen untouched; "visible" drives the window the user is looking at. Use "visible" only when the user asked to see, open, or browse something.',
  },
} as const;

export const CANCELLED_BY_USER = 'Cancelled by the user';

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

/** `fail(CANCELLED_BY_USER)` when the turn was stopped, otherwise null: `const c = cancelled(signal); if (c) return c;`. */
export const cancelled = (signal?: AbortSignal): ToolResult | null => (signal?.aborted ? fail(CANCELLED_BY_USER) : null);

/**
 * Navigates, reporting a stop as the user's cancellation rather than as an error. Checks the signal
 * on both sides of the load so an abort that lands mid-navigation still stops the tool.
 */
export async function navigateStep(view: XViewLike, url: string, signal?: AbortSignal): Promise<ToolResult | null> {
  if (signal?.aborted) return fail(CANCELLED_BY_USER);
  try { await view.navigate(url, signal); }
  catch (err) {
    if (signal?.aborted) return fail(CANCELLED_BY_USER);
    throw err;
  }
  return cancelled(signal);
}

/**
 * One hidden window cannot serve two navigate-then-read sequences at once: the second navigation
 * would move the page out from under the first read. Calls on one view queue; the interactive and
 * the scheduled-run windows are different objects, so they never wait on each other.
 */
const queues = new WeakMap<XViewLike, Promise<void>>();

export function lockView(view: XViewLike): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const previous = queues.get(view) ?? Promise.resolve();
  queues.set(view, previous.then(() => held));
  return previous.then(() => release);
}

/** Resolves the view, holds its lock for the whole of `fn`, and releases it however `fn` ends. */
export async function withView(ctx: XViewToolCtx, target: ViewTarget, fn: (view: XViewLike) => Promise<ToolResult>): Promise<ToolResult> {
  const view = await pickView(ctx, target);
  if (isToolResult(view)) return view;
  const release = await lockView(view);
  try { return await fn(view); }
  finally { release(); }
}
