import type { PostingMode } from '../shared/settings';

export const AUTONOMOUS_WARNING = 'Autonomous mode lets the agent post without asking you. Continue?';

/** Gate for switching posting mode: returns the mode to apply, or null when the user declined the warning. */
export function confirmPostingMode(next: PostingMode, confirmFn: (message: string) => boolean): PostingMode | null {
  if (next === 'autonomous' && !confirmFn(AUTONOMOUS_WARNING)) return null;
  return next;
}
