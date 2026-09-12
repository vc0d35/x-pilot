import { z } from 'zod';
import { MEDIA_URL_MAX } from './media-url';

/** The post a post quotes: another author's post, rendered inside the quoting one. */
export const QuotedPostSchema = z.object({
  authorHandle: z.string().max(64),
  authorName: z.string().max(128),
  text: z.string().max(20_000),
  postedAt: z.string().max(64).nullable(),
});
export type QuotedPost = z.infer<typeof QuotedPostSchema>;

/** A link preview card attached to a post; `image` is the card's picture, on one of X's own hosts. */
export const LinkCardSchema = z.object({
  url: z.string().max(512),
  title: z.string().max(200),
  image: z.string().max(MEDIA_URL_MAX).optional(),
});
export type LinkCard = z.infer<typeof LinkCardSchema>;

/**
 * An image, video or GIF attached to a post. `alt` is whatever description X carries, when it is not
 * the generic one; `url` is the picture itself or a video's own file, `preview` a video's poster
 * frame. Every URL here came through `mediaUrl`, so it is https on one of X's own hosts or absent —
 * a video played from a `blob:` source has no `url`, only a `preview`.
 */
export const MediaSchema = z.object({
  kind: z.enum(['image', 'video', 'gif']),
  alt: z.string().max(1000).optional(),
  url: z.string().max(MEDIA_URL_MAX).optional(),
  preview: z.string().max(MEDIA_URL_MAX).optional(),
});
export type Media = z.infer<typeof MediaSchema>;

// Every string here is page-controlled and ends up persisted or in a prompt, so each one is bounded.
export const PostSchema = z.object({
  id: z.string().max(32),
  url: z.string().max(512),
  authorHandle: z.string().max(64),
  authorName: z.string().max(128),
  text: z.string().max(20_000),
  postedAt: z.string().max(64).nullable(),
  kind: z.enum(['post', 'article']),
  articleTitle: z.string().max(1000).nullable().optional(),
  articleBody: z.string().max(200_000).nullable().optional(),
  stats: z
    .object({ replies: z.number(), reposts: z.number(), likes: z.number(), bookmarks: z.number(), views: z.number() })
    .nullable()
    .optional(),
  /** Read from the state of the post's own buttons; absent where the page renders none. */
  liked: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
  quoted: QuotedPostSchema.nullable().optional(),
  /** The author's profile picture, on one of X's own hosts. */
  authorAvatar: z.string().max(MEDIA_URL_MAX).optional(),
  cards: z.array(LinkCardSchema).max(8).optional(),
  media: z.array(MediaSchema).max(4).optional(),
});
export type Post = z.infer<typeof PostSchema>;

export const PageKindSchema = z.enum([
  'home',
  'post',
  'article',
  'profile',
  'search',
  'likes',
  'bookmarks',
  'notifications',
  'compose',
  'other',
]);
export type PageKind = z.infer<typeof PageKindSchema>;

export const PageStateSchema = z.object({
  url: z.string(),
  kind: PageKindSchema,
  title: z.string(),
  /** True when every extractor this page kind depends on found something: `layout && (posts ?? true) && (article ?? true)`. */
  adapterHealthy: z.boolean(),
  /** Per-extractor signals, so a markup change shows up as the one thing that broke. */
  health: z.object({ layout: z.boolean(), posts: z.boolean().optional(), article: z.boolean().optional() }),
  /** Count announced by the "Show N posts" pill, when one is on screen. */
  newPostsAvailable: z.number().optional(),
  /** The unread count on the navigation bar's Notifications entry; absent when the page has no navigation bar. */
  unreadNotifications: z.number().optional(),
});
export type PageState = z.infer<typeof PageStateSchema>;

/** A post visible in the viewport of a timeline-like page: enough to refer to it, not the full text. */
export const VisiblePostSchema = z.object({
  id: z.string().max(32),
  url: z.string().max(512),
  authorHandle: z.string().max(64),
  text: z.string().max(20_000),
  /** Only who is quoted and a short excerpt: the hint says a quote is there, the read tools give the rest. */
  quoted: z.object({ authorHandle: z.string().max(64), text: z.string().max(280) }).optional(),
});
export type VisiblePost = z.infer<typeof VisiblePostSchema>;

/** What the user is looking at: a focused post (post/article pages, reply dialogs) or the posts on screen. */
export const PageContextSchema = z.object({
  url: z.string(),
  kind: PageKindSchema,
  post: PostSchema.nullable(),
  visible: z.array(VisiblePostSchema).optional(),
  unreadNotifications: z.number().optional(),
});
export type PageContext = z.infer<typeof PageContextSchema>;

export const NotificationKindSchema = z.enum(['post', 'like', 'repost', 'follow', 'new_posts', 'other']);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/**
 * One entry of the Notifications page. A reply or a mention is a post and carries it; a like, a
 * repost, a follow or "new posts from" is X's own line about who did what, and the post it is about
 * is reached only by opening the entry, which is what `x_open_notification` does with the id.
 */
export const NotificationSchema = z.object({
  /** Stable across re-renders: a hash of what the entry says, since X gives it no id. */
  id: z.string().max(16),
  kind: NotificationKindSchema,
  /** The line X wrote, such as "Alex liked your reply", names included. */
  headline: z.string().max(500),
  actors: z.array(z.object({ handle: z.string().max(64), name: z.string().max(128) })).max(20),
  /** The excerpt of the post the entry is about, or the post's own text. */
  text: z.string().max(2000),
  at: z.string().max(64).nullable(),
  post: PostSchema.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;
