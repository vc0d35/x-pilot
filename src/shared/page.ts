import { z } from 'zod';

export const PostSchema = z.object({
  id: z.string(),
  url: z.string(),
  authorHandle: z.string(),
  authorName: z.string(),
  text: z.string(),
  postedAt: z.string().nullable(),
  kind: z.enum(['post', 'article']),
  articleTitle: z.string().nullable().optional(),
  articleBody: z.string().nullable().optional(),
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
});
export type PageState = z.infer<typeof PageStateSchema>;

export const PageContextSchema = z.object({ url: z.string(), post: PostSchema });
export type PageContext = z.infer<typeof PageContextSchema>;
