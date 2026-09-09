import { describe, it, expect } from 'vitest';
import {
  NO_PROVIDER_MESSAGE,
  modelLabel,
  needsProviderChoice,
  pillText,
  providerState,
  showReconnect,
  showsProviderBadge,
} from './provider-ui';
import type { ModelInfo } from '../shared/sidebar-api';

const models: ModelInfo[] = [
  { id: 'claude-opus-5', displayName: 'Opus 5', isDefault: false, reasoningEfforts: ['low', 'high'] },
  { id: 'claude-sonnet-5', displayName: 'Sonnet 5', isDefault: true, reasoningEfforts: ['low', 'high'] },
];

describe('needsProviderChoice', () => {
  it('is the first-run state: no provider in settings, or main saying so', () => {
    expect(needsProviderChoice(null, 'starting')).toBe(true);
    expect(needsProviderChoice(null, 'disconnected', NO_PROVIDER_MESSAGE)).toBe(true);
    expect(needsProviderChoice('claude', 'disconnected', NO_PROVIDER_MESSAGE)).toBe(true);
  });

  it('is not a normal disconnect of a provider that is chosen', () => {
    expect(needsProviderChoice('codex', 'disconnected', 'codex exited (1)')).toBe(false);
    expect(needsProviderChoice('codex', 'ready')).toBe(false);
  });
});

describe('modelLabel', () => {
  it('prefers the display name, then the id, then the backend', () => {
    expect(modelLabel('claude', 'claude-opus-5', models)).toBe('Opus 5');
    expect(modelLabel('claude', 'claude-haiku-4-5-20251001', models)).toBe('claude-haiku-4-5-20251001');
    expect(modelLabel('codex', null, [])).toBe('Codex');
    expect(modelLabel(null, null, models)).toBe('no model');
  });

  it('falls back to the list default when settings name no model', () => {
    expect(modelLabel('claude', null, models)).toBe('Sonnet 5');
  });
});

describe('pillText', () => {
  const base = { provider: 'claude' as const, modelId: 'claude-opus-5', models };

  it('names the model while the agent can answer', () => {
    expect(pillText({ ...base, status: 'ready' })).toBe('Opus 5');
    expect(pillText({ ...base, status: 'running' })).toBe('Opus 5');
  });

  it('shows the state instead while it cannot', () => {
    expect(pillText({ ...base, status: 'starting' })).toBe('connecting…');
    expect(pillText({ ...base, status: 'error' })).toBe('error');
    expect(pillText({ ...base, status: 'disconnected', statusMessage: 'codex exited (1)' })).toBe('disconnected');
  });

  it('points at the picker while nothing is chosen, whatever the sidebar opened on', () => {
    expect(pillText({ status: 'disconnected', statusMessage: NO_PROVIDER_MESSAGE, provider: null, modelId: null, models: [] })).toBe(
      'choose a model',
    );
    expect(pillText({ status: 'starting', provider: null, modelId: null, models: [] })).toBe('choose a model');
    expect(pillText({ ...base, status: 'disconnected', statusMessage: NO_PROVIDER_MESSAGE })).toBe('choose a model');
  });
});

describe('showReconnect', () => {
  it('offers a reconnect for a backend that has one, and never before one is chosen', () => {
    expect(showReconnect('disconnected', 'codex')).toBe(true);
    expect(showReconnect('error', 'claude')).toBe(true);
    expect(showReconnect('ready', 'codex')).toBe(false);
    expect(showReconnect('disconnected', null)).toBe(false);
  });
});

describe('showsProviderBadge', () => {
  it('marks only the conversations the other backend wrote', () => {
    expect(showsProviderBadge('codex', 'claude')).toBe(true);
    expect(showsProviderBadge('claude', 'claude')).toBe(false);
    expect(showsProviderBadge('codex', null)).toBe(false);
  });
});

describe('providerState', () => {
  it('reads a row in the order the states override each other', () => {
    expect(providerState({ active: true, checking: true, connected: true })).toBe('checking…');
    expect(providerState({ active: true, checking: false, connected: false })).toBe('active');
    expect(providerState({ active: false, checking: false, connected: true })).toBe('connected');
    expect(providerState({ active: false, checking: false, connected: false })).toBe('not connected');
  });
});
