import { z } from 'zod';
import { toolSpec, type ToolDef, type ToolSpec, clampedInt } from '../../../../shared/tools';

/**
 * The adapter's tool surface as a compile-time constant. Main imports this so the agent's tool list
 * never depends on the X page having loaded; nothing here may touch the DOM at module load.
 */

export const pageStateDef = {
  name: 'x_get_page_state',
  description:
    'Returns the current x.com URL, page kind (home, post, article, profile, search, likes, bookmarks, notifications, compose, other), title, whether the page adapter recognises the layout, per-extractor health signals, newPostsAvailable when a "Show N posts" pill is on screen, and unreadNotifications, the count on the navigation bar\'s Notifications entry.',
  args: z.strictObject({
    timeoutMs: z.int().min(0).default(8000).describe('How long to wait for the page layout to render before reporting'),
  }),
  annotations: { readOnlyHint: true },
} satisfies ToolDef;

export const readVisiblePostsDef = {
  name: 'x_read_visible_posts',
  description:
    'Reads the posts currently rendered on the page (timeline, search results, profile, likes). Returns id, url, author, text, time and stats. Use x_scroll to load more.',
  args: z.strictObject({ limit: clampedInt(1, 100, 'How many posts to return', 20) }),
  annotations: { readOnlyHint: true },
} satisfies ToolDef;

export const readCurrentPostDef = {
  name: 'x_read_current_post',
  description:
    "Reads the post the page is currently showing (must be on a post or article page): full text, any post it quotes, its link cards and media, the author's own thread continuation, and the X Article title/body when present.",
  args: z.strictObject({ timeoutMs: z.int().default(10000) }),
  annotations: { readOnlyHint: true },
} satisfies ToolDef;

export const scrollDef = {
  name: 'x_scroll',
  description:
    'Scrolls the window the user is looking at to load more content (e.g. to roll through the timeline when asked). direction: "down" (default) or "up"; amount in pixels (default 800).',
  args: z.strictObject({ direction: z.enum(['down', 'up']).optional(), amount: clampedInt(100, 5000, 'Pixels to scroll') }),
} satisfies ToolDef;

export const readComposerDef = {
  name: 'x_read_composer',
  description: 'Reads the open post composer: whether it is open, its current text, and whether Post is enabled.',
  args: z.strictObject({ timeoutMs: z.int().default(5000) }),
  annotations: { readOnlyHint: true, internal: true },
} satisfies ToolDef;

export const typeInComposerDef = {
  name: 'x_type_in_composer',
  description: 'Types text into the open composer (used when the compose URL did not prefill it).',
  args: z.strictObject({ text: z.string() }),
  annotations: { internal: true },
} satisfies ToolDef;

export const clickPostButtonDef = {
  name: 'x_click_post_button',
  description:
    'Clicks the Post button of the open composer and reports the confirmation toast and new post URL if shown. Internal: main calls this after approval.',
  args: z.strictObject({ timeoutMs: z.int().default(8000) }),
  annotations: { destructiveHint: true, internal: true },
} satisfies ToolDef;

export const likeInPageDef = {
  name: 'x_like_in_page',
  description: 'Internal: like or unlike a post rendered in this window by post URL or id.',
  args: z.strictObject({ url: z.string(), action: z.enum(['like', 'unlike']).optional(), timeoutMs: z.int().default(8000) }),
  annotations: { destructiveHint: true, internal: true },
} satisfies ToolDef;

export const readNotificationsInPageDef = {
  name: 'x_read_notifications_in_page',
  description: 'Internal: reads the entries of the Notifications page rendered in this window.',
  args: z.strictObject({ limit: clampedInt(1, 100, 'How many entries to return', 50) }),
  annotations: { readOnlyHint: true, internal: true },
} satisfies ToolDef;

export const openNotificationInPageDef = {
  name: 'x_open_notification_in_page',
  description:
    'Internal: opens one entry of the Notifications page rendered in this window, by the id a read gave it, and reports where it went.',
  args: z.strictObject({ id: z.string().max(16), timeoutMs: z.int().default(8000) }),
  annotations: { internal: true },
} satisfies ToolDef;

export const bookmarkInPageDef = {
  name: 'x_bookmark_in_page',
  description: 'Internal: bookmark or unbookmark a post rendered in this window by post URL or id.',
  args: z.strictObject({ url: z.string(), action: z.enum(['bookmark', 'unbookmark']).optional(), timeoutMs: z.int().default(8000) }),
  annotations: { destructiveHint: true, internal: true },
} satisfies ToolDef;

export const selectHomeTabDef = {
  name: 'x_select_home_tab',
  description: 'Internal: click the Home tab whose label matches (e.g. "For you", "Following").',
  args: z.strictObject({ label: z.string() }),
  annotations: { internal: true },
} satisfies ToolDef;

export const readWidgetsDef = {
  name: 'x_read_widgets',
  description: 'Internal: read the "What\'s happening" trends and "Today\'s News" headlines rendered in this window.',
  args: z.strictObject({ timeoutMs: z.int().min(0).default(8000) }),
  annotations: { readOnlyHint: true, internal: true },
} satisfies ToolDef;

export const showNewPostsDef = {
  name: 'x_show_new_posts',
  description:
    'Clicks the "Show N posts" pill that X puts at the top of the timeline in the window the user is looking at when new posts have arrived, so they load on screen. Returns shown: false when there is no pill. x_get_page_state and x_scroll report newPostsAvailable when one is present.',
  args: z.strictObject({}),
} satisfies ToolDef;

export const inspectPageDef = {
  name: 'x_inspect_page',
  description:
    'Returns the markup of the elements matching a CSS selector on the page in this window: for each match its tag, the attributes that identify it (data-testid, role, aria-label, href, class) and its outer HTML, truncated. Use it when a read comes back empty or adapterHealthy is false, to see what X actually renders and work out what a selector should be; then try candidates with xpilot_test_selector. Defaults to the page body, so start there and narrow down.',
  args: z.strictObject({
    selector: z.string().optional().describe('The CSS selector to look at; the page body when omitted'),
    limit: clampedInt(1, 20, 'How many matches to return', 5),
  }),
  annotations: { readOnlyHint: true },
} satisfies ToolDef;

export const testSelectorDef = {
  name: 'x_test_selector',
  description:
    'Internal: runs a CSS selector against the page in this window and reports whether the browser can parse it and how many elements it matches.',
  args: z.strictObject({ selector: z.string() }),
  annotations: { readOnlyHint: true, internal: true },
} satisfies ToolDef;

/** The order the preload registers them in. */
export const adapterToolSpecs: ToolSpec[] = [
  pageStateDef,
  readVisiblePostsDef,
  readCurrentPostDef,
  scrollDef,
  readComposerDef,
  typeInComposerDef,
  clickPostButtonDef,
  likeInPageDef,
  bookmarkInPageDef,
  readNotificationsInPageDef,
  openNotificationInPageDef,
  selectHomeTabDef,
  readWidgetsDef,
  showNewPostsDef,
  inspectPageDef,
  testSelectorDef,
].map(toolSpec);
