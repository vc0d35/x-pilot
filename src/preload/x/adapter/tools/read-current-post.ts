import { fail, ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';
import { expandShowMore, sleep, waitFor } from '../dom';
import { extractArticle, extractPost, extractThread, findMainArticle, pageKindFromUrl, postFromArticleUrl } from '../extract';
import { SEL } from '../selectors';

export const readCurrentPost: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_read_current_post',
    description: 'Reads the post the page is currently showing (must be on a post or article page): full text, the author\'s own thread continuation, and the X Article title/body when present.',
    inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', default: 10000 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (args) => {
    const url = location.href;
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 10_000;
    try { await waitFor(() => document.querySelector(SEL.article) ?? document.querySelector(SEL.articleView), timeoutMs); }
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
};
