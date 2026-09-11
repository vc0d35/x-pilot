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

/** Console, preload, crash and script-error lines kept per view, oldest dropped. */
export const VIEW_LOG_LIMIT = 200;
export const VIEW_LOG_TEXT_MAX = 2000;

/**
 * How a view failed, as the sidebar says it. `load` is a page that would not load at all (or has no
 * index.html, or whose preload failed), `crash` a renderer that died, `unresponsive` one that wedged,
 * `runtime` an error the view's own scripts threw while it was up and rendering.
 */
export const VIEW_ERROR_PHASES = ['load', 'crash', 'unresponsive', 'runtime'] as const;
export type ViewErrorPhase = (typeof VIEW_ERROR_PHASES)[number];

/** How long a wedged renderer is given to come back before the view is taken off the screen. */
export const VIEW_UNRESPONSIVE_MS = 10_000;
/** More runtime errors than this inside the window and the view is deactivated rather than watched. */
export const VIEW_RUNTIME_ERRORS_PER_WINDOW = 20;
export const VIEW_RUNTIME_ERROR_WINDOW_MS = 60_000;
/** A second crash or wedge this soon after the first is a view that cannot be retried into. */
export const VIEW_FATAL_ERRORS_PER_WINDOW = 2;
export const VIEW_FATAL_ERROR_WINDOW_MS = 5 * 60_000;
/** After the first runtime error of an activation, the banner is raised at most this often. */
export const VIEW_RUNTIME_REPORT_MS = 30_000;
/** Consecutive change-triggered reloads that failed to load before reloading is stopped. */
export const VIEW_RELOAD_FAILURES_MAX = 2;
/** What the user and the agent are told when a view is deactivated for erroring too much. */
export const VIEW_STORM_MESSAGE = 'too many errors; deactivated';

/** The preload's error relay: how many reports a view may send, how often, and how long one may be. */
export const VIEW_ERROR_REPORTS_PER_WINDOW = 10;
export const VIEW_ERROR_REPORT_WINDOW_MS = 10_000;
export const VIEW_ERROR_MESSAGE_MAX = 1024;
export const VIEW_ERROR_SOURCE_MAX = 200;

/** What xpilot_view_console may return: entries, how long each line may be, and how much in total. */
export const VIEW_CONSOLE_DEFAULT_LIMIT = 50;
export const VIEW_CONSOLE_MAX_LIMIT = 200;
export const VIEW_CONSOLE_TEXT_MAX = 500;
export const VIEW_CONSOLE_BYTES_MAX = 20 * 1024;

/** The canvas may call this many tools per window; the rest are refused with a reason. */
export const VIEW_CALLS_PER_WINDOW = 20;
export const VIEW_CALL_WINDOW_MS = 10_000;
/** How often the posts feed re-reads the X page while a view is subscribed to it. */
export const VIEW_POSTS_POLL_MS = 3_000;
/** How long a view the user is being shown stays up with nobody answering the card. */
export const VIEW_PREVIEW_MAX_MS = 10 * 60 * 1000;

export const VIEW_FEEDS = ['page', 'posts', 'message'] as const;
export type ViewFeed = (typeof VIEW_FEEDS)[number];

/**
 * What a view may publish about what it is showing, so the agent can answer about the view rather
 * than about the X page hidden under it. Every field is page data written by agent-written code, so
 * each one is capped here, capped again in main, and fenced before it reaches the model.
 */
export const VIEW_STATE_SUMMARY_MAX = 300;
export const VIEW_STATE_FOCUS_TEXT_MAX = 1000;
export const VIEW_STATE_ITEM_TEXT_MAX = 200;
export const VIEW_STATE_ITEMS_MAX = 20;
export const VIEW_STATE_HANDLE_MAX = 64;
export const VIEW_STATE_URL_MAX = 512;
export const VIEW_STATE_EXTRA_KEYS_MAX = 20;
export const VIEW_STATE_EXTRA_KEY_MAX = 64;
export const VIEW_STATE_EXTRA_VALUE_MAX = 200;
/** The whole state, serialised: a view that publishes more than this is publishing a page, not a state. */
export const VIEW_STATE_BYTES_MAX = 8 * 1024;
/** A view redraws at frame rate; what the agent needs is the newest state, four times a second. */
export const VIEW_STATE_UPDATES_PER_WINDOW = 4;
export const VIEW_STATE_WINDOW_MS = 1000;
/** One message the agent sends a view, serialised. */
export const VIEW_MESSAGE_BYTES_MAX = 4 * 1024;

/** The one item a view says the user is looking at: what "this post" means while the view is up. */
export interface ViewFocus {
  url?: string;
  authorHandle?: string;
  text?: string;
}

/** One of the things a view is showing, as a line the agent can refer to. */
export interface ViewStateItem {
  url?: string;
  authorHandle?: string;
  text?: string;
}

/**
 * What `window.xpilotView.setState` publishes. `focus` is the item the view considers current —
 * `null` says nothing is — and `extra` is whatever else the view wants the agent to know about
 * itself: a filter, a mode, a count.
 */
export interface ViewState {
  summary?: string;
  focus?: ViewFocus | null;
  items?: ViewStateItem[];
  extra?: Record<string, string | number | boolean>;
}

/**
 * The view on screen as the agent sees it: which one, what it last published (null while it has
 * published nothing), and when. `xpilot_view_state` answers with this, and the turn hint is built
 * from it.
 */
export interface ActiveViewState {
  view: string;
  state: ViewState | null;
  updatedAt: string | null;
}

/**
 * The registry tools a view may call. Reads and drivers, because the X page underneath is the data
 * source and moving it is how a view loads more; the four writes keep their confirm cards in the
 * sidebar. Everything else — internal tools, and every xpilot_* config, task and view tool — is
 * refused, so a view can neither rewrite the app's configuration nor build another view.
 */
export const VIEW_READ_TOOLS: readonly string[] = [
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
];
/** Moving the X page underneath, which is how a view loads more of it. */
export const VIEW_DRIVER_TOOLS: readonly string[] = ['x_scroll', 'x_show_new_posts', 'x_navigate'];
/** The four account writes. From a view every one of them asks the user, whatever the mode says. */
export const VIEW_ACCOUNT_WRITE_TOOLS: readonly string[] = ['x_like_post', 'x_bookmark_post', 'x_compose_post', 'x_submit_post'];

export const VIEW_TOOL_ALLOWLIST: readonly string[] = [...VIEW_READ_TOOLS, ...VIEW_DRIVER_TOOLS, ...VIEW_ACCOUNT_WRITE_TOOLS];

/**
 * A view the user has not kept yet is on screen so they can look at it, and nothing more: it reads
 * and it draws. Driving the X page or writing to the account is what "Keep" buys, so until the card
 * is answered a preview gets the reads and the feeds only.
 */
export const VIEW_PREVIEW_TOOL_ALLOWLIST: readonly string[] = VIEW_READ_TOOLS;
export const VIEW_PREVIEW_REFUSAL = 'This view is a preview; keep it first';

export interface ViewSummary {
  name: string;
  files: number;
  bytes: number;
  /** False when the folder has no index.html, which is the only file the canvas can load. */
  hasIndex: boolean;
}

/** One line the canvas produced: a console message, a preload failure, a dead renderer, or a thrown error. */
export interface ViewLogEntry {
  at: string;
  source: 'console' | 'preload' | 'crash' | 'error';
  level: string;
  text: string;
  /** `file:line:col` for an error the view's own scripts threw, when it said where. */
  where?: string;
}

/** What a view's preload relays when its scripts throw; every field is capped before it is kept. */
export interface ViewErrorReport {
  kind: 'error' | 'unhandledrejection' | 'securitypolicyviolation';
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

/**
 * One row of the Settings views list and one item of the View menu: enough to offer the view and to
 * say why it cannot be offered. `bytes` is deliberately absent — nothing in either surface shows it.
 */
export interface ViewListEntry {
  name: string;
  files: number;
  hasIndex: boolean;
  /** True for the view on screen, which the two surfaces mark and offer "Back to X" for instead. */
  active: boolean;
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

/**
 * What each feed delivers. `page` is the same PageContext the sidebar gets, `posts` its visible
 * posts, and `message` whatever the agent sent with `xpilot_view_message` — a plain object the view
 * defined the meaning of itself.
 */
export interface ViewFeedPayload {
  page: PageContext | null;
  posts: VisiblePost[];
  message: Record<string, unknown>;
}

/**
 * `window.xpilotView` inside a custom view: the live feeds off the X page underneath, the allowlisted
 * tools, the way back to the agent, and the two shortcuts a view always needs. There is nothing else
 * — no network, no storage of the X session, no way to reach the app's configuration.
 */
export interface XPilotViewApi {
  /** Calls back with the current value straight away, then on every change. Returns an unsubscribe. */
  subscribe<F extends ViewFeed>(feed: F, cb: (data: ViewFeedPayload[F]) => void): () => void;
  /**
   * Publishes what the view is showing, so the agent's turn hint and `xpilot_view_state` describe
   * the view rather than the X page under it. Never rejects: a state main refused comes back as
   * `{ success: false, error }`. Four updates a second, the newest winning.
   */
  setState(state: ViewState): Promise<ToolResult>;
  /**
   * Runs one allowlisted registry tool. Nothing here ever throws or rejects: a refusal, a budget,
   * a dead bridge and a tool that failed all come back the same way, as `{ success: false, error }`.
   */
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Moves the X page underneath to a URL on x.com, which is how a view loads something new. */
  openInX(url: string): Promise<ToolResult>;
  /** Closes the view and puts the user back on X. Never rejects. */
  back(): Promise<void>;
}
