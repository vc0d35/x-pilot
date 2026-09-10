import type { PageContext, VisiblePost } from './page';
import type { ToolResult } from './tools';

/**
 * Custom views: a whole replacement UI for the X page, written by the agent into the profile and
 * rendered in its own view over x.com. The page underneath stays loaded and is the only data source
 * a view has — there is no network in the canvas, and nothing a view does runs inside x.com.
 */

/** A view is a folder name: lowercase, no dots, no separators, so it can never be a path. */
export const VIEW_NAME_PATTERN = '^[a-z0-9][a-z0-9-]{0,39}$';
export const VIEW_NAME_RE = new RegExp(VIEW_NAME_PATTERN);

/** What a view may be built out of. Anything else is refused before it reaches the folder. */
export const VIEW_FILE_EXTENSIONS = ['html', 'js', 'mjs', 'css', 'json', 'svg', 'txt', 'md'] as const;

export const MAX_VIEW_FILE_BYTES = 512 * 1024;
export const MAX_VIEW_BYTES = 5 * 1024 * 1024;
/** The file the canvas loads; a view without one cannot be shown. */
export const VIEW_ENTRY_FILE = 'index.html';

/** Console, preload and crash lines kept per view, oldest dropped. */
export const VIEW_LOG_LIMIT = 200;
export const VIEW_LOG_TEXT_MAX = 2000;

/** The canvas may call this many tools per window; the rest are refused with a reason. */
export const VIEW_CALLS_PER_WINDOW = 20;
export const VIEW_CALL_WINDOW_MS = 10_000;
/** How often the posts feed re-reads the X page while a view is subscribed to it. */
export const VIEW_POSTS_POLL_MS = 3_000;
/** How long a view the user is being shown stays up with nobody answering the card. */
export const VIEW_PREVIEW_MAX_MS = 10 * 60 * 1000;

export const VIEW_FEEDS = ['page', 'posts'] as const;
export type ViewFeed = (typeof VIEW_FEEDS)[number];

/**
 * The registry tools a view may call. Reads and drivers, because the X page underneath is the data
 * source and moving it is how a view loads more; the four writes keep their confirm cards in the
 * sidebar. Everything else — internal tools, and every xpilot_* config, task and view tool — is
 * refused, so a view can neither rewrite the app's configuration nor build another view.
 */
export const VIEW_TOOL_ALLOWLIST: readonly string[] = [
  'x_get_page_state',
  'x_read_visible_posts',
  'x_read_current_post',
  'x_read_post',
  'x_search',
  'x_read_timeline',
  'x_read_news_and_trends',
  'x_read_bookmarks',
  'xpilot_search_history',
  'xpilot_list_library',
  'x_scroll',
  'x_show_new_posts',
  'x_navigate',
  'x_like_post',
  'x_bookmark_post',
  'x_compose_post',
  'x_submit_post',
];

export interface ViewSummary {
  name: string;
  files: number;
  bytes: number;
  /** False when the folder has no index.html, which is the only file the canvas can load. */
  hasIndex: boolean;
}

/** One line the canvas produced: a console message, a preload failure, or a dead renderer. */
export interface ViewLogEntry {
  at: string;
  source: 'console' | 'preload' | 'crash';
  level: string;
  text: string;
}

/** What the sidebar shows in the Views row: which view is up, where they live, and what there is. */
export interface ViewsStatus {
  active: string | null;
  dir: string;
  views: ViewSummary[];
}

export function isViewName(name: string): boolean {
  return VIEW_NAME_RE.test(name);
}

/** What each feed delivers. `page` is the same PageContext the sidebar gets; `posts` is its visible posts. */
export interface ViewFeedPayload {
  page: PageContext | null;
  posts: VisiblePost[];
}

/**
 * `window.xpilotView` inside a custom view: two live feeds off the X page underneath, the allowlisted
 * tools, and the two shortcuts a view always needs. There is nothing else — no network, no storage
 * of the X session, no way to reach the app's configuration.
 */
export interface XPilotViewApi {
  /** Calls back with the current value straight away, then on every change. Returns an unsubscribe. */
  subscribe<F extends ViewFeed>(feed: F, cb: (data: ViewFeedPayload[F]) => void): () => void;
  /** Runs one allowlisted registry tool; the result is the plain `{ success, content }` a tool returns. */
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Moves the X page underneath to a URL on x.com, which is how a view loads something new. */
  openInX(url: string): Promise<ToolResult>;
  /** Closes the view and puts the user back on X. */
  back(): Promise<void>;
}
