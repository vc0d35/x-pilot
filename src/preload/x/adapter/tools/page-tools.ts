import { ok, type ToolModule } from '../../../../shared/tools';
import type { PreloadCtx } from '../../context';

export const listPageTools: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_list_page_tools',
    description: 'Lists tools the current page itself registered through the WebMCP modelContext API (usually none on x.com).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  execute: async (_args, ctx) => ok(ctx.pageTools.list()),
};

export const callPageTool: ToolModule<PreloadCtx> = {
  spec: {
    name: 'x_call_page_tool',
    description: 'Calls a page-registered WebMCP tool by name with JSON arguments.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'], additionalProperties: false },
  },
  execute: async (args, ctx) => ctx.pageTools.call(String(args.name), (args.args as Record<string, unknown>) ?? {}),
};
