import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker } from './ModelPicker';
import { ModelPill } from './Header';

describe('the first-run model picker', () => {
  it('offers both backends with what each of them needs', () => {
    const html = renderToStaticMarkup(createElement(ModelPicker, { onConnected: () => {} }));
    expect(html).toContain('Choose a model to connect');
    expect(html).toContain('Codex CLI installed and logged in');
    expect(html).toContain('Claude Code installed and logged in');
    expect(html.match(/>Connect</g)).toHaveLength(2);
  });
});

describe('ModelPill', () => {
  const pill = (props: Partial<Parameters<typeof ModelPill>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ModelPill, {
        status: 'ready',
        label: 'Sonnet 5',
        canReconnect: false,
        onOpenSettings: () => {},
        onReconnect: () => {},
        ...props,
      }),
    );

  it('shows the model and the dot of the current status', () => {
    const html = pill();
    expect(html).toContain('Sonnet 5');
    expect(html).toContain('status-ready');
    expect(html).not.toContain('reconnect');
  });

  it('keeps a reconnect within reach while the agent is down', () => {
    expect(pill({ status: 'error', label: 'error', canReconnect: true })).toContain('reconnect');
  });
});
