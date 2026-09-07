import { fail, ok, type ToolModule } from '../../../shared/tools';
import { normalizePostUrl } from '../xview/read-post';
import type { AppToolCtx } from './context';

export const savePdf: ToolModule<AppToolCtx> = {
  spec: {
    name: 'xpilot_save_article_pdf',
    description: 'Saves a post, thread, or X Article as a PDF in the user\'s library folder for reading later. Returns the file path. Renders in a hidden window; the visible page is not disturbed.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'x.com post or article URL' } }, required: ['url'], additionalProperties: false },
  },
  execute: async (args, ctx) => {
    const url = normalizePostUrl(String(args.url ?? ''));
    if (!url) return fail(`Not a post or article URL: ${String(args.url ?? '')}`);
    try {
      const { path, title } = await ctx.exportPdf(url, ctx.libraryDir());
      const idMatch = /\/(\d+)$/.exec(url);
      ctx.history.addLibraryItem({ postId: idMatch ? idMatch[1] : null, url, path, title });
      return ok({ path, title });
    } catch (err) {
      return fail(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
