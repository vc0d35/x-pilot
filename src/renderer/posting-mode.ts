import type { PostingMode, StylesMode, ViewsMode } from '../shared/settings';

export const AUTONOMOUS_WARNING = 'Autonomous mode lets the agent post without asking you. Continue?';

export const AUTONOMOUS_STYLES_WARNING =
  'Autonomous page styles let the agent restyle the X page without asking you. CSS on that page can hide or cover the controls you click. Continue?';

/** Gate for switching posting mode: returns the mode to apply, or null when the user declined the warning. */
export function confirmPostingMode(next: PostingMode, confirmFn: (message: string) => boolean): PostingMode | null {
  if (next === 'autonomous' && !confirmFn(AUTONOMOUS_WARNING)) return null;
  return next;
}

/** The same gate for page styles, whose autonomous mode gives the agent the page the user clicks on. */
export function confirmStylesMode(next: StylesMode, confirmFn: (message: string) => boolean): StylesMode | null {
  if (next === 'autonomous' && !confirmFn(AUTONOMOUS_STYLES_WARNING)) return null;
  return next;
}

export const AUTONOMOUS_VIEWS_WARNING =
  'Autonomous views let the agent replace the X page with a UI it wrote, without asking you first. Continue?';

/** The same gate for custom views, whose autonomous mode puts an agent-written UI over X unasked. */
export function confirmViewsMode(next: ViewsMode, confirmFn: (message: string) => boolean): ViewsMode | null {
  if (next === 'autonomous' && !confirmFn(AUTONOMOUS_VIEWS_WARNING)) return null;
  return next;
}
