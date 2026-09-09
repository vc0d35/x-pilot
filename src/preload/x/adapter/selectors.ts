import { SELECTOR_DEFAULTS, SELECTOR_KEYS, type SelectorKey } from '../../../shared/selectors';

/**
 * Every x.com DOM selector the adapter uses, as one mutable object the forty-odd call sites read
 * through. The shipped values live in `src/shared/selectors.ts`; the user's overrides are applied
 * over them in place by `applySelectorOverrides`, before any tool runs.
 */
export const SEL: Record<SelectorKey, string> = { ...SELECTOR_DEFAULTS };

/**
 * A selector the browser cannot parse is not merely useless: several call sites interpolate two of
 * them into one list (`${SEL.trend}, ${SEL.newsArticle}`) and run it on every click or every second,
 * so one bad value would throw across the whole adapter. The browser is asked, and a value it
 * refuses falls back to the shipped default.
 */
function usable(selector: string): boolean {
  try {
    document.querySelectorAll(selector);
    return true;
  } catch {
    return false;
  }
}

/** Puts every key back to its shipped default, then applies the overrides that are still valid. */
export function applySelectorOverrides(overrides: Partial<Record<string, string>>): void {
  for (const key of SELECTOR_KEYS) {
    const override = overrides[key];
    const wanted = typeof override === 'string' && override.trim().length > 0 ? override : null;
    if (wanted !== null && !usable(wanted)) {
      console.warn(`[xpilot] the selector override for ${key} is not one the browser accepts; using the shipped default`);
      SEL[key] = SELECTOR_DEFAULTS[key];
      continue;
    }
    SEL[key] = wanted ?? SELECTOR_DEFAULTS[key];
  }
}

/** Label of the new-posts pill; the count is the first capture group. */
export const NEW_POSTS_LABEL = /^show\s+([\d,.]+)\s+posts?$/i;

export const RESERVED_TOP_LEVEL = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'search',
  'settings',
  'i',
  'compose',
  'intent',
  'login',
  'signup',
  'logout',
  'bookmarks',
  'lists',
  'communities',
  'jobs',
  'premium',
  'tos',
  'privacy',
]);
