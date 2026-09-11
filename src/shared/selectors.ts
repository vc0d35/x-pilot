/**
 * The adapter's CSS selectors as data: the shipped defaults and a line per key saying what it points
 * at. DOM-free and dependency-free, so main can list, describe and override them without loading the
 * preload, and the preload can import the same defaults it started from.
 */
export const SELECTOR_DEFAULTS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  permalinkTime: 'a[href*="/status/"] time',
  statsGroup: '[role="group"][aria-label]',
  quotedPost: 'div[role="link"][tabindex="0"]:has([data-testid="tweetText"])',
  linkCard: '[data-testid="card.wrapper"]',
  tweetPhoto: '[data-testid="tweetPhoto"] img',
  videoPlayer: '[data-testid="videoPlayer"]',
  showMore: '[data-testid="tweet-text-show-more-link"]',
  likeButton: 'button[data-testid="like"]',
  unlikeButton: 'button[data-testid="unlike"]',
  bookmarkButton: 'button[data-testid="bookmark"]',
  removeBookmarkButton: 'button[data-testid="removeBookmark"]',
  composerTextarea: '[data-testid="tweetTextarea_0"]',
  postButton: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]',
  dialog: '[role="dialog"]',
  toast: '[data-testid="toast"]',
  homeTab: '[role="tab"]',
  articleView: '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]',
  articleBody: '[data-testid="twitterArticleRichTextView"]',
  articleTitle: '[data-testid="twitter-article-title"]',
  sectionHeading: 'h2',
  trend: '[data-testid="trend"]',
  newsArticle: '[data-testid^="news_sidebar_article_"]',
  timelineCell: '[data-testid="cellInnerDiv"]',
  newPostsButton: '[data-testid="primaryColumn"] [data-testid="cellInnerDiv"] button',
} satisfies Record<string, string>;

export type SelectorKey = keyof typeof SELECTOR_DEFAULTS;

export const SELECTOR_KEYS = Object.keys(SELECTOR_DEFAULTS) as SelectorKey[];

export const isSelectorKey = (key: string): key is SelectorKey => key in SELECTOR_DEFAULTS;

/**
 * The selectors a tool clicks, types into, or reads to decide that an action happened. Redirecting
 * one of these does not change what the agent sees, it changes what the agent *does*: the composer
 * text the approval card shows and re-checks, which button Post presses, which control a like lands
 * on. They are therefore not settable from a tool at all — only by the user editing selectors.json.
 */
export const ACTION_SELECTOR_KEYS = new Set<SelectorKey>([
  'composerTextarea',
  'postButton',
  'likeButton',
  'unlikeButton',
  'bookmarkButton',
  'removeBookmarkButton',
  'homeTab',
  'showMore',
  'dialog',
  'toast',
]);

export const isActionSelectorKey = (key: string): boolean => ACTION_SELECTOR_KEYS.has(key as SelectorKey);

/** One line per key: what the selector has to match for the tools that use it to work. */
export const SELECTOR_DESCRIPTIONS: Record<SelectorKey, string> = {
  primaryColumn: "X's main content column; its absence means the layout was not recognised",
  article: 'One post as rendered in a timeline, thread or search result; the root every post field is read from',
  tweetText: "The text body of a post, inside its article; empty text is usually this selector's fault",
  userName: 'The author block of a post, holding the display name and the @handle',
  permalinkTime: "The post's timestamp link, which is where its URL and id come from",
  statsGroup: 'The reply/repost/like/view bar of a post, whose aria-label carries the counts',
  quotedPost:
    'The post another post quotes, rendered inside the quoting article; everything inside it belongs to the quoted author, not to the post',
  linkCard: 'The link preview card of a post, holding the target URL and the headline',
  tweetPhoto: 'An image attached to a post, whose alt text is the only description of it we get',
  videoPlayer: 'The video player of a post with a video or GIF attached',
  showMore: 'The "Show more" link on a truncated post, clicked before reading the full text',
  likeButton: 'The Like button of a post, in its not-yet-liked state',
  unlikeButton: 'The Like button of a post the user has already liked, in its liked state',
  bookmarkButton: 'The Bookmark button of a post, in its not-yet-bookmarked state',
  removeBookmarkButton: 'The Bookmark button of a post the user has already bookmarked, in its bookmarked state',
  composerTextarea: 'The text box of the open post composer',
  postButton: 'The Post button of the composer, in the inline and the dialog composer alike',
  dialog: 'A modal X opens over the page, such as the reply composer',
  toast: 'The confirmation toast X shows after an action, read to tell whether a post went out',
  homeTab: 'One tab of the Home timeline bar, such as "For you" or "Following"',
  articleView: 'The container of a long-form X Article page',
  articleBody: 'The rich-text body of an X Article, without the author header and follow controls',
  articleTitle: 'The title element of an X Article',
  sectionHeading: 'The heading of a right-column section, used to find "What\'s happening" and "Today\'s News"',
  trend: 'One trend entry in the "What\'s happening" widget or on Explore',
  newsArticle: 'One headline entry in the "Today\'s News" widget',
  timelineCell: 'One cell of a timeline list, the wrapper X puts around posts and inline widgets',
  newPostsButton: 'The "Show N posts" pill X inserts at the top of a timeline when new posts have arrived',
};
