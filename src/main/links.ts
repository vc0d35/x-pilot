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

export interface LinkRouterDeps {
  allowHosts(): string[];
  headFetch(url: string): Promise<{ status: number; location: string | null }>;
  openExternal(url: string): void;
  loadInView(url: string): void;
}

export interface LinkRouter {
  openShortLink(url: string): void;
  /** Links clicked in the sidebar follow the same rules as links in the page. */
  openLink(url: string): void;
}

export function createLinkRouter(deps: LinkRouterDeps): LinkRouter {
  const openShortLink = (url: string) => {
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
