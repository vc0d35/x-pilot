import { SELECTOR_DEFAULTS, SELECTOR_KEYS, type SelectorKey } from '../../../shared/selectors';

/**
 * Every x.com DOM selector the adapter uses, as one mutable object the forty-odd call sites read
 * through. The shipped values live in `src/shared/selectors.ts`; the user's overrides are applied
 * over them in place by `applySelectorOverrides`, before any tool runs.
 */
export const SEL: Record<SelectorKey, string> = { ...SELECTOR_DEFAULTS };

/** Puts every key back to its shipped default, then applies the overrides that are still valid. */
export function applySelectorOverrides(overrides: Partial<Record<string, string>>): void {
  for (const key of SELECTOR_KEYS) {
    const override = overrides[key];
    SEL[key] = typeof override === 'string' && override.trim().length > 0 ? override : SELECTOR_DEFAULTS[key];
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
