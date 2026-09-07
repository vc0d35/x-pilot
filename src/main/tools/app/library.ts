import { resolve } from 'node:path';
import { fail, ok, type ToolModule } from '../../../shared/tools';
import { isInsideDir } from '../../library/paths';
import type { AppToolCtx } from './context';

export const listLibrary: ToolModule<AppToolCtx> = {
  spec: { name: 'xpilot_list_library', description: 'Lists PDFs saved to the library, newest first.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  execute: async (args, ctx) => ok(ctx.history.listLibrary(typeof args.limit === 'number' ? args.limit : 50)),
};

export const openPdf: ToolModule<AppToolCtx> = {
  spec: { name: 'xpilot_open_pdf', description: 'Opens a saved PDF from the library in the system viewer.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  execute: async (args, ctx) => {
    const path = resolve(String(args.path ?? ''));
    if (!isInsideDir(path, ctx.libraryDir())) return fail('Refusing to open a file outside the library folder');
    const err = await ctx.openPath(path);
    return err ? fail(`Could not open PDF: ${err}`) : ok({ opened: true });
  },
};
