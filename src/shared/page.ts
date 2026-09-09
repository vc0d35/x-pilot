import { z } from 'zod';

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
  stats: z.object({ replies: z.number(), reposts: z.number(), likes: z.number(), views: z.number() }).nullable().optional(),
});
export type Post = z.infer<typeof PostSchema>;

export const PageKindSchema = z.enum(['home', 'post', 'article', 'profile', 'search', 'likes', 'compose', 'other']);
export type PageKind = z.infer<typeof PageKindSchema>;

export const PageStateSchema = z.object({
  url: z.string(),
  kind: PageKindSchema,
  title: z.string(),
  adapterHealthy: z.boolean(),
  /** Count announced by the "Show N posts" pill, when one is on screen. */
  newPostsAvailable: z.number().optional(),
});
export type PageState = z.infer<typeof PageStateSchema>;

/** A post visible in the viewport of a timeline-like page: enough to refer to it, not the full text. */
export const VisiblePostSchema = z.object({ id: z.string().max(32), url: z.string().max(512), authorHandle: z.string().max(64), text: z.string().max(20_000) });
export type VisiblePost = z.infer<typeof VisiblePostSchema>;

/** What the user is looking at: a focused post (post/article pages, reply dialogs) or the posts on screen. */
export const PageContextSchema = z.object({
  url: z.string(),
  kind: PageKindSchema,
  post: PostSchema.nullable(),
  visible: z.array(VisiblePostSchema).optional(),
});
export type PageContext = z.infer<typeof PageContextSchema>;
