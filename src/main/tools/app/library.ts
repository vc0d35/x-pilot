import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool, fail, ok } from '../../../shared/tools';
import { isOpenablePdf } from '../../library/paths';
import type { AppToolCtx } from './context';

export const listLibrary = defineTool({
  name: 'xpilot_list_library',
  description: 'Lists PDFs saved to the library, newest first.',
  args: z.strictObject({ limit: z.int().min(1).max(500).default(50) }),
  annotations: { readOnlyHint: true },
  execute: async (args, ctx: AppToolCtx) => ok(ctx.history.listLibrary(args.limit)),
});

export const openPdf = defineTool({
  name: 'xpilot_open_pdf',
  description: 'Opens a saved PDF from the library in the system viewer.',
  args: z.strictObject({ path: z.string() }),
  execute: async (args, ctx: AppToolCtx) => {
    const path = resolve(args.path);
    if (!isOpenablePdf(path, ctx.libraryDir(), (p) => ctx.history.hasLibraryPath(p))) return fail('Refusing to open a file that is not a PDF in the library');
    const err = await ctx.openPath(path);
    return err ? fail(`Could not open PDF: ${err}`) : ok({ opened: true });
  },
});
