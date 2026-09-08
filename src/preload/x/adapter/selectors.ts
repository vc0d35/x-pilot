/** Every x.com DOM selector lives here. If X changes its markup, this is the only file to touch. */
export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  permalinkTime: 'a[href*="/status/"] time',
  statsGroup: '[role="group"][aria-label]',
  showMore: '[data-testid="tweet-text-show-more-link"]',
  likeButton: 'button[data-testid="like"]',
  unlikeButton: 'button[data-testid="unlike"]',
  composerTextarea: '[data-testid="tweetTextarea_0"]',
  postButton: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]',
  dialog: '[role="dialog"]',
  toast: '[data-testid="toast"]',
  homeTab: '[role="tab"]',
  // Long-form X Articles. Verify against a captured fixture; both known test ids are tried.
  articleView: '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]',
  /** The rich-text body only (the read view also contains the author header and follow controls). */
  articleBody: '[data-testid="twitterArticleRichTextView"]',
  articleTitle: '[data-testid="twitter-article-title"]',
} as const;

export const RESERVED_TOP_LEVEL = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose', 'intent', 'login', 'signup', 'logout', 'bookmarks', 'lists', 'communities', 'jobs', 'premium', 'tos', 'privacy']);
