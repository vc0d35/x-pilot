import type { ToolSpec } from '../../../../shared/tools';

/**
 * The adapter's tool surface as a compile-time constant. Main imports this so the agent's tool list
 * never depends on the X page having loaded; nothing here may touch the DOM at module load.
 */

export const pageStateSpec: ToolSpec = {
  name: 'x_get_page_state',
  description: 'Returns the current x.com URL, page kind (home, post, article, profile, search, likes, compose, other), title, whether the page adapter recognises the layout, per-extractor health signals, and newPostsAvailable when a "Show N posts" pill is on screen.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 0, default: 8000, description: 'How long to wait for the page layout to render before reporting' } }, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

export const readVisiblePostsSpec: ToolSpec = {
  name: 'x_read_visible_posts',
  description: 'Reads the posts currently rendered on the page (timeline, search results, profile, likes). Returns id, url, author, text, time and stats. Use x_scroll to load more.',
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

export const readCurrentPostSpec: ToolSpec = {
  name: 'x_read_current_post',
  description: 'Reads the post the page is currently showing (must be on a post or article page): full text, the author\'s own thread continuation, and the X Article title/body when present.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 10000 } }, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

export const scrollSpec: ToolSpec = {
  name: 'x_scroll',
  description: 'Scrolls the window the user is looking at to load more content (e.g. to roll through the timeline when asked). direction: "down" (default) or "up"; amount in pixels (default 800).',
  inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] }, amount: { type: 'integer', minimum: 100, maximum: 5000 } }, additionalProperties: false },
};

export const readComposerSpec: ToolSpec = {
  name: 'x_read_composer',
  description: 'Reads the open post composer: whether it is open, its current text, and whether Post is enabled.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 5000 } }, additionalProperties: false },
  annotations: { readOnlyHint: true, internal: true },
};

export const typeInComposerSpec: ToolSpec = {
  name: 'x_type_in_composer',
  description: 'Types text into the open composer (used when the compose URL did not prefill it).',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  annotations: { internal: true },
};

export const clickPostButtonSpec: ToolSpec = {
  name: 'x_click_post_button',
  description: 'Clicks the Post button of the open composer and reports the confirmation toast and new post URL if shown. Internal: main calls this after approval.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 8000 } }, additionalProperties: false },
  annotations: { destructiveHint: true, internal: true },
};

export const likeInPageSpec: ToolSpec = {
  name: 'x_like_in_page',
  description: 'Internal: like or unlike a post rendered in this window by post URL or id.',
  inputSchema: { type: 'object', properties: { url: { type: 'string' }, action: { type: 'string', enum: ['like', 'unlike'] }, timeoutMs: { type: 'integer', default: 8000 } }, required: ['url'], additionalProperties: false },
  annotations: { destructiveHint: true, internal: true },
};

export const selectHomeTabSpec: ToolSpec = {
  name: 'x_select_home_tab',
  description: 'Internal: click the Home tab whose label matches (e.g. "For you", "Following").',
  inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
  annotations: { internal: true },
};

export const readWidgetsSpec: ToolSpec = {
  name: 'x_read_widgets',
  description: 'Internal: read the "What\'s happening" trends and "Today\'s News" headlines rendered in this window.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 0, default: 8000 } }, additionalProperties: false },
  annotations: { readOnlyHint: true, internal: true },
};

export const showNewPostsSpec: ToolSpec = {
  name: 'x_show_new_posts',
  description: 'Clicks the "Show N posts" pill that X puts at the top of the timeline in the window the user is looking at when new posts have arrived, so they load on screen. Returns shown: false when there is no pill. x_get_page_state and x_scroll report newPostsAvailable when one is present.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** The order the preload registers them in. */
export const adapterToolSpecs: ToolSpec[] = [
  pageStateSpec,
  readVisiblePostsSpec,
  readCurrentPostSpec,
  scrollSpec,
  readComposerSpec,
  typeInComposerSpec,
  clickPostButtonSpec,
  likeInPageSpec,
  selectHomeTabSpec,
  readWidgetsSpec,
  showNewPostsSpec,
];
