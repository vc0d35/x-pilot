import { defineTool, fail, ok } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { expandShowMore, sleep, waitFor } from '../dom';
import { extractArticle, extractPost, extractThread, findMainArticle, pageKindFromUrl, postFromArticleUrl } from '../extract';
import { SEL } from '../selectors';
import { readCurrentPostDef } from './specs';

export const readCurrentPost = defineTool({
  ...readCurrentPostDef,
  execute: async (args, _ctx: PreloadCtx) => {
    const url = location.href;
    try { await waitFor(() => document.querySelector(SEL.article) ?? document.querySelector(SEL.articleView), args.timeoutMs); }
    catch (err) { return fail(`No post found on this page (${err instanceof Error ? err.message : String(err)})`); }
    if (expandShowMore(document, SEL.showMore) > 0) await sleep(300);
    const main = findMainArticle(document, url);
    const mainPost = main ? extractPost(main, url) : null;
    const article = pageKindFromUrl(url) === 'article' ? extractArticle(document) : null;
    // Some X Articles render only the reader view, with no tweet element to extract from.
    const post = mainPost ?? postFromArticleUrl(url, article?.title ?? '');
    if (!post) return fail('No post found on this page');
    if (article) { post.kind = 'article'; post.articleTitle = article.title; post.articleBody = article.body; }
    return ok({ post, thread: main && mainPost ? extractThread(document, main, post.authorHandle) : [], article });
  },
});
