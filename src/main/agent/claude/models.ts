import type { ModelInfo } from '../../../shared/sidebar-api';

/** Every current Claude model takes the same effort levels. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The Agent SDK has no model catalogue to ask, so the list is static; an id the user types into
 * settings.json is still passed through, because the CLI is the one that validates it.
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', displayName: 'Opus 5', isDefault: false, reasoningEfforts: CLAUDE_EFFORTS },
  { id: 'claude-sonnet-5', displayName: 'Sonnet 5', isDefault: true, reasoningEfforts: CLAUDE_EFFORTS },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', isDefault: false, reasoningEfforts: CLAUDE_EFFORTS },
];
