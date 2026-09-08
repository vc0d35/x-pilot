import { fail, type ToolModule } from '../../../shared/tools';
import { decideNavigation } from '../../navigation/policy';
import type { XViewToolCtx } from './context';

export const navigate: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_navigate',
    description: 'Navigates the window the USER is looking at to a URL on x.com (home, a profile, a post, search, likes…) and returns the page state. Only use when the user asked to open, show, or go somewhere; for reading use x_read_post or x_search instead.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
  },
  execute: async (args, ctx) => {
    const url = String(args.url ?? '');
    if (decideNavigation(url, ctx.allowHosts()) !== 'allow') return fail(`Refusing to navigate outside x.com: ${url}`);
    await ctx.xview.navigate(url);
    return ctx.xview.callPreload('x_get_page_state', {});
  },
};
