import { fail, type ToolModule } from '../../../shared/tools';
import { decideNavigation } from '../../navigation/policy';
import type { XViewToolCtx } from './context';
import { navigateStep, withView } from './target';

/**
 * Paths that act, or expose the account itself, on load: logging out, the settings tree, the
 * login/signup flows, and the intent and compose endpoints that pre-fill an action for one click.
 * Composing has its own two-step tool, and the rest are the user's to do themselves.
 */
const OFF_LIMITS = /^\/(logout|settings|account|intent|compose|login|signup|i\/flow)(\/|$)/;

export const navigate: ToolModule<XViewToolCtx> = {
  spec: {
    name: 'x_navigate',
    description: 'Navigates the window the USER is looking at to a URL on x.com (home, a profile, a post, search, likes…) and returns the page state. Only use when the user asked to open, show, or go somewhere; for reading use x_read_post or x_search instead.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
  },
  execute: async (args, ctx, signal) => {
    const url = String(args.url ?? '');
    if (decideNavigation(url, ctx.allowHosts()) !== 'allow') return fail(`Refusing to navigate outside x.com: ${url}`);
    let path = '';
    try { path = new URL(url).pathname.toLowerCase(); } catch { return fail(`Not a URL: ${url}`); }
    if (OFF_LIMITS.test(path)) return fail(`Refusing to open ${path}: it changes the user's account or session. Ask the user to do this themselves; to write a post use x_compose_post.`);
    return withView(ctx, 'visible', async (view) => {
      const stopped = await navigateStep(view, url, signal);
      if (stopped) return stopped;
      return view.callPreload('x_get_page_state', {}, signal);
    });
  },
};
