import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { fail, type ToolResult } from '../../shared/tools';
import {
  VIEW_CALLS_PER_WINDOW,
  VIEW_CALL_WINDOW_MS,
  VIEW_FEEDS,
  VIEW_POSTS_POLL_MS,
  VIEW_TOOL_ALLOWLIST,
  type ViewFeed,
} from '../../shared/views';
import type { PageContext, VisiblePost } from '../../shared/page';
import { createBudget } from '../links';

const CallSchema = z.object({ tool: z.string().max(80), args: z.record(z.string(), z.unknown()).optional() });
const FeedSchema = z.object({ feed: z.enum(VIEW_FEEDS) });

/** The slice of ipcMain this module drives, so the wiring can be tested without Electron. */
export interface ViewBridgeIpc {
  handle(channel: string, listener: (event: { sender: { id: number } }, payload: unknown) => unknown): void;
  on(channel: string, listener: (event: { sender: { id: number } }, payload: unknown) => void): void;
}

export interface ViewBridgeDeps {
  ipc: ViewBridgeIpc;
  /** The canvas's WebContents id, or null when there is no canvas: every message is checked against it. */
  canvasId(): number | null;
  /** Pushes one feed message to the canvas. */
  send(message: { feed: ViewFeed; data: unknown }): void;
  /** Runs a tool on the interactive registry, exactly as the agent would. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** The last PageContext the X view reported, for a subscriber that has just arrived. */
  pageContext(): PageContext | null;
  /** `back()`: take the view off and put the user back on X. */
  deactivate(): void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

/**
 * Why a tool a view asked for was refused, or null when it may run. The allowlist is the whole
 * answer: a view is our own UI, but it is written by a model out of what a page said, so it reaches
 * the reads and the drivers it needs to render X and the four writes that ask the user first, and
 * nothing that could change the app itself.
 */
export function refuseToolCall(name: string): string | null {
  if (VIEW_TOOL_ALLOWLIST.includes(name)) return null;
  return `A custom view may not call ${name}. It may call: ${VIEW_TOOL_ALLOWLIST.join(', ')}.`;
}

export interface ViewBridge {
  /** A new PageContext from the X view: pushed to whichever feeds are subscribed. */
  pushPage(context: PageContext | null): void;
  /** The canvas navigated, or went away: its subscriptions died with its document. */
  reset(): void;
}

const visiblePostsOf = (context: PageContext | null): VisiblePost[] => context?.visible ?? [];

/**
 * The main half of `window.xpilotView`. Every message is checked against the canvas's own
 * WebContents id — the same ipcMain carries the sidebar and the X views — and calls are budgeted, so
 * a view in a render loop cannot drive x.com at frame rate.
 */
export function registerViewBridgeIpc(deps: ViewBridgeDeps): ViewBridge {
  const budget = createBudget({ max: VIEW_CALLS_PER_WINDOW, windowMs: VIEW_CALL_WINDOW_MS, now: deps.now });
  const setTimer = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((t) => clearInterval(t));
  const subscribed = new Set<ViewFeed>();
  let poller: NodeJS.Timeout | null = null;

  const fromCanvas = (event: { sender: { id: number } }): boolean => {
    const id = deps.canvasId();
    return id !== null && event.sender.id === id;
  };

  /**
   * The live half of the posts feed. The PageContext only changes when X tells the preload something
   * changed; a timeline the user is scrolling through changes far more often than that, so the feed
   * re-reads the visible posts while somebody is listening.
   */
  const pollPosts = (): void => {
    void deps
      .callTool('x_read_visible_posts', { limit: 50 })
      .then((r) => {
        if (!subscribed.has('posts') || !r.success || !Array.isArray(r.content)) return;
        deps.send({ feed: 'posts', data: r.content as VisiblePost[] });
      })
      .catch(() => {});
  };

  const syncPoller = (): void => {
    if (subscribed.has('posts') && !poller) poller = setTimer(pollPosts, VIEW_POSTS_POLL_MS);
    else if (!subscribed.has('posts') && poller) {
      clearTimer(poller);
      poller = null;
    }
  };

  deps.ipc.on(IPC.viewSubscribe, (event, raw) => {
    if (!fromCanvas(event)) return;
    const parsed = FeedSchema.safeParse(raw);
    if (!parsed.success) return;
    const feed = parsed.data.feed;
    subscribed.add(feed);
    syncPoller();
    // Whatever is known right now, so a view renders on its first frame rather than on the next change.
    if (feed === 'page') deps.send({ feed, data: deps.pageContext() });
    else {
      deps.send({ feed, data: visiblePostsOf(deps.pageContext()) });
      pollPosts();
    }
  });

  deps.ipc.on(IPC.viewUnsubscribe, (event, raw) => {
    if (!fromCanvas(event)) return;
    const parsed = FeedSchema.safeParse(raw);
    if (!parsed.success) return;
    subscribed.delete(parsed.data.feed);
    syncPoller();
  });

  deps.ipc.handle(IPC.viewCall, async (event, raw): Promise<ToolResult> => {
    if (!fromCanvas(event)) return fail('unauthorized');
    const parsed = CallSchema.safeParse(raw);
    if (!parsed.success) return fail('A view call needs a tool name and an object of arguments.');
    const refusal = refuseToolCall(parsed.data.tool);
    if (refusal) return fail(refusal);
    if (!budget.take())
      return fail(
        `Too many tool calls from this view: at most ${VIEW_CALLS_PER_WINDOW} every ${VIEW_CALL_WINDOW_MS / 1000} s. Subscribe to a feed instead of polling.`,
      );
    return deps.callTool(parsed.data.tool, parsed.data.args ?? {});
  });

  deps.ipc.handle(IPC.viewBack, (event) => {
    if (!fromCanvas(event)) throw new Error('unauthorized');
    deps.deactivate();
  });

  return {
    pushPage(context) {
      if (subscribed.has('page')) deps.send({ feed: 'page', data: context });
      if (subscribed.has('posts')) deps.send({ feed: 'posts', data: visiblePostsOf(context) });
    },
    reset() {
      subscribed.clear();
      syncPoller();
    },
  };
}
