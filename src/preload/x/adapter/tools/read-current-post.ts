import { defineTool, fail, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { expandShowMore, sleep, waitFor } from '../dom';
import {
  extractArticle,
  extractConversation,
  extractPost,
  extractRepliesBelow,
  findMainArticle,
  pageKindFromUrl,
  postFromArticleUrl,
} from '../extract';
import { SEL } from '../selectors';
import { readCurrentPostDef, readRepliesInPageDef } from './specs';

export const readCurrentPost = defineTool({
  ...readCurrentPostDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const url = location.href;
    try {
      await waitFor(() => document.querySelector(SEL.article) ?? document.querySelector(SEL.articleView), args.timeoutMs);
    } catch (err) {
      return fail(`No post found on this page (${err instanceof Error ? err.message : String(err)})`);
    }
    if (expandShowMore(document, SEL.showMore) > 0) await sleep(300);
    const main = findMainArticle(document, url);
    const mainPost = main ? extractPost(main, url) : null;
    const article = pageKindFromUrl(url) === 'article' ? extractArticle(document) : null;
    // Some X Articles render only the reader view, with no tweet element to extract from.
    const post = mainPost ?? postFromArticleUrl(url, article?.title ?? '');
    if (!post) return fail('No post found on this page');
    if (article) {
      post.kind = 'article';
      post.articleTitle = article.title;
      post.articleBody = article.body;
    }
    const conversation =
      main && mainPost ? extractConversation(document, main, post.authorHandle) : { ancestors: [], thread: [], replies: [] };
    return ok({ post, ...conversation, article });
  },
});

/** Internal: the replies a post page shows after scrolling, for the read that wants more of them. */
export const readRepliesInPage = defineTool({
  ...readRepliesInPageDef,
  execute: async (args, _ctx: PreloadCtx) => {
    try {
      await waitFor(() => document.querySelector(SEL.article), 8000);
    } catch {
      /* report whatever is there */
    }
    if (expandShowMore(document, SEL.showMore) > 0) await sleep(300);
    return ok(extractRepliesBelow(document, location.href).slice(0, args.limit));
  },
});
