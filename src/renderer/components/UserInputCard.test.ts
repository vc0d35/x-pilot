import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserInputCard } from './UserInputCard';
import type { UserInputAnswers, UserInputRequest } from '../../shared/agent';

const request: UserInputRequest = {
  id: 'in-1',
  questions: [
    { id: 'q1', prompt: 'Which account?' },
    { id: 'q2', prompt: 'How fast?', options: ['fast', 'slow'] },
    { id: 'q3', prompt: 'Passphrase', secret: true },
  ],
};

const render = (props: { resolved?: { answers: UserInputAnswers } } = {}) =>
  renderToStaticMarkup(createElement(UserInputCard, { request, onResolve: () => {}, ...props }));

describe('UserInputCard', () => {
  it('renders one field per question: a select for options and a password box for secrets', () => {
    const html = render();
    expect(html).toContain('Which account?');
    expect(html).toContain('<option value="fast"');
    expect(html).toContain('<option value="slow"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Submit');
    expect(html).toContain('Skip');
  });

  it('replaces the fields with the outcome once answered, without echoing a secret', () => {
    const answered = render({ resolved: { answers: { q1: '@me', q3: 'hunter2' } } });
    expect(answered).toContain('Answered');
    expect(answered).not.toContain('hunter2');
    expect(answered).not.toContain('<input');
    expect(answered).not.toContain('Submit');
    expect(render({ resolved: { answers: null } })).toContain('Skipped');
  });
});
