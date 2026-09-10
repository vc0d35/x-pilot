import { z } from 'zod';
import { callingView, defineTool, fail } from '../../../shared/tools';
import { decideNavigation } from '../../navigation/policy';
import { isShortLinkHost } from '../../navigation/shortlink';
import type { XViewToolCtx } from './context';
import { navigateStep, withView } from './target';

/**
 * Paths that act, or expose the account itself, on load: logging out, the settings tree, the
 * login/signup flows, and the intent and compose endpoints that pre-fill an action for one click.
 * Composing has its own two-step tool, and the rest are the user's to do themselves.
 */
const OFF_LIMITS = /^\/(logout|settings|account|intent|compose|login|signup|i\/flow)(\/|$)/;

/**
 * Where a custom view may move the X page. The user's own navigation allowlist is for links the
 * *user* clicks, and it holds `t.co`: a short link is an attacker-chosen redirect that the page
 * policy would hand to the system browser, which is egress out of a window with no network. A view
 * gets x.com and twitter.com over https, and nothing else.
 */
const VIEW_NAV_HOSTS = ['x.com', 'twitter.com'];

/** Where X leaves a composer open with text already in it: an intent URL, or the compose tree. */
const PRE_FILLED = /^\/(intent|compose)(\/|$)/;

/**
 * True when the X window is sitting on a page that has an action pre-filled — the composer with
 * somebody's text in it, one click from a post. Whoever takes a custom view off the screen checks
 * this: the user asked to go back to X, not to be handed a draft they did not write.
 */
export function isComposeUrl(url: string): boolean {
  try {
    return PRE_FILLED.test(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
}

function refuseViewNavigation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Not a URL: ${url}`;
  }
  const host = parsed.hostname.toLowerCase();
  const onX = VIEW_NAV_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (parsed.protocol !== 'https:' || !onX || isShortLinkHost(url))
    return `A custom view may only open https pages on ${VIEW_NAV_HOSTS.join(' or ')}: ${url}`;
  return null;
}

export const navigate = defineTool({
  name: 'x_navigate',
  description:
    'Navigates the window the USER is looking at to a URL on x.com (home, a profile, a post, search, likes…) and returns the page state. Only use when the user asked to open, show, or go somewhere; for reading use x_read_post or x_search instead.',
  args: z.strictObject({ url: z.string() }),
  execute: async (args, ctx: XViewToolCtx, signal) => {
    const url = args.url;
    if (callingView(ctx)) {
      const refusal = refuseViewNavigation(url);
      if (refusal) return fail(refusal);
    }
    if (decideNavigation(url, ctx.allowHosts()) !== 'allow') return fail(`Refusing to navigate outside x.com: ${url}`);
    let path: string;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      return fail(`Not a URL: ${url}`);
    }
    if (OFF_LIMITS.test(path))
      return fail(
        `Refusing to open ${path}: it changes the user's account or session. Ask the user to do this themselves; to write a post use x_compose_post.`,
      );
    return withView(ctx, 'visible', async (view) => {
      const stopped = await navigateStep(view, url, signal);
      if (stopped) return stopped;
      return view.callPreload('x_get_page_state', {}, signal);
    });
  },
});
