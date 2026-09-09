import { PROVIDER_LABELS, type AgentStatus, type ProviderKind } from '../shared/agent';
import type { ModelInfo } from '../shared/sidebar-api';

/** What the controller reports while no backend is chosen (`NO_PROVIDER_MESSAGE` in main). */
export const NO_PROVIDER_MESSAGE = 'Choose a model to connect';

/** The one line each option of the first-run picker carries under its name. */
export const PROVIDER_REQUIREMENT: Record<ProviderKind, string> = {
  codex: 'Codex CLI installed and logged in',
  claude: 'Claude Code installed and logged in',
};

/**
 * The first-run picker is up while nothing is chosen. The status is the same signal from the other
 * side: main reports `disconnected` with that message instead of starting a backend.
 */
export function needsProviderChoice(provider: ProviderKind | null, status: AgentStatus, statusMessage?: string): boolean {
  return provider === null || (status === 'disconnected' && statusMessage === NO_PROVIDER_MESSAGE);
}

/** The chosen model as a person reads it: its display name, else its id, else the backend's name. */
export function modelLabel(provider: ProviderKind | null, modelId: string | null, models: ModelInfo[]): string {
  if (!provider) return 'no model';
  const chosen = modelId ?? models.find((m) => m.isDefault)?.id ?? null;
  if (!chosen) return PROVIDER_LABELS[provider];
  return models.find((m) => m.id === chosen)?.displayName ?? chosen;
}

export interface PillInput {
  status: AgentStatus;
  statusMessage?: string;
  provider: ProviderKind | null;
  modelId: string | null;
  models: ModelInfo[];
}

/** The header pill's text: the model while the agent can answer, otherwise what is wrong. */
export function pillText(input: PillInput): string {
  // Nothing is starting up before a backend is chosen, whatever status the sidebar opened on.
  if (input.provider === null) return 'choose a model';
  switch (input.status) {
    case 'ready':
    case 'running':
      return modelLabel(input.provider, input.modelId, input.models);
    case 'starting':
      return 'connecting…';
    case 'disconnected':
      return input.statusMessage === NO_PROVIDER_MESSAGE ? 'choose a model' : 'disconnected';
    case 'error':
      return 'error';
  }
}

/** Reconnect is only an answer once a backend exists to reconnect to; before that the picker is. */
export function showReconnect(status: AgentStatus, provider: ProviderKind | null): boolean {
  return provider !== null && (status === 'disconnected' || status === 'error');
}

/** A History row says which backend wrote it only when that is not the one in use. */
export function showsProviderBadge(conversation: ProviderKind, active: ProviderKind | null): boolean {
  return active !== null && conversation !== active;
}

export type ProviderState = 'active' | 'connected' | 'not connected' | 'checking…';

/** What the Settings row for one provider reads, in the order the states override each other. */
export function providerState(opts: { active: boolean; checking: boolean; connected: boolean }): ProviderState {
  if (opts.checking) return 'checking…';
  if (opts.active) return 'active';
  return opts.connected ? 'connected' : 'not connected';
}
