import { resolveShortLink, routeShortLink, sidebarLinkAction } from './navigation/shortlink';

/**
 * Wraps an action so a page (or a runaway agent) cannot spray the user's system browser with
 * windows: at most `max` calls per rolling `windowMs`, the rest dropped with a warning.
 */
export function rateLimit<A extends unknown[]>(
  fn: (...args: A) => void,
  opts: { max: number; windowMs: number; now?: () => number; warn?: (message: string) => void },
): (...args: A) => void {
  const now = opts.now ?? Date.now;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  let times: number[] = [];
  return (...args: A) => {
    const t = now();
    times = times.filter((x) => t - x < opts.windowMs);
    if (times.length >= opts.max) {
      warn(`[xpilot] dropped a request: more than ${opts.max} in ${opts.windowMs} ms`);
      return;
    }
    times.push(t);
    fn(...args);
  };
}

/**
 * A rolling-window allowance. `take()` is true while fewer than `max` calls have landed in the last
 * `windowMs`. Unlike `rateLimit` it does not wrap the call, because a caller over budget has
 * somewhere else to go rather than dropping the request.
 */
export function createBudget(opts: { max: number; windowMs: number; now?: () => number }): { take(): boolean } {
  const now = opts.now ?? Date.now;
  let times: number[] = [];
  return {
    take() {
      const t = now();
      times = times.filter((x) => t - x < opts.windowMs);
      if (times.length >= opts.max) return false;
      times.push(t);
      return true;
    },
  };
}

/**
 * Resolving a t.co link is an outbound HEAD request that a page chooses for us, so a page full of
 * short links (or an agent clicking through one) is an egress channel with a request rate attached.
 * Past the budget the link still works: it goes to the system browser unresolved, which is what the
 * router does anyway for anything that does not resolve back onto the allowlist.
 */
export const SHORT_LINK_BUDGET = { max: 20, windowMs: 60_000 };

export interface LinkRouterDeps {
  allowHosts(): string[];
  headFetch: (url: string) => Promise<{ status: number; location: string | null }>;
  openExternal(url: string): void;
  loadInView(url: string): void;
  now?: () => number;
  warn?: (message: string) => void;
}

export interface LinkRouter {
  openShortLink: (url: string) => void;
  /** Links clicked in the sidebar follow the same rules as links in the page. */
  openLink: (url: string) => void;
}

export function createLinkRouter(deps: LinkRouterDeps): LinkRouter {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const resolutions = createBudget({ ...SHORT_LINK_BUDGET, now: deps.now });
  const openShortLink = (url: string) => {
    if (!resolutions.take()) {
      warn(
        `[xpilot] more than ${SHORT_LINK_BUDGET.max} short links resolved in ${SHORT_LINK_BUDGET.windowMs} ms; opening this one unresolved`,
      );
      deps.openExternal(url);
      return;
    }
    void resolveShortLink(url, deps.headFetch).then((target) => {
      const route = routeShortLink(target, deps.allowHosts());
      if (route === 'view') deps.loadInView(target);
      else if (route === 'external') deps.openExternal(target);
    });
  };
  const openLink = (url: string) => {
    const action = sidebarLinkAction(url, deps.allowHosts());
    if (action === 'short') openShortLink(url);
    else if (action === 'view') deps.loadInView(url);
    else if (action === 'external') deps.openExternal(url);
  };
  return { openShortLink, openLink };
}
