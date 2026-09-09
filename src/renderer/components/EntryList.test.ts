import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityLabel, ApprovalCard } from './EntryList';
import type { Entry } from '../state';

const request = {
  id: 'a1',
  kind: 'post' as const,
  title: 'Keep these page styles?',
  detail: 'a { color: red }',
  options: [
    { id: 'keep', label: 'Keep' },
    { id: 'adjust', label: 'Adjust…', note: true },
    { id: 'revert', label: 'Revert' },
  ],
};
const card = (entry: Partial<Extract<Entry, { kind: 'approval' }>> = {}) =>
  renderToStaticMarkup(createElement(ApprovalCard, { entry: { kind: 'approval', request, ...entry }, onResolve: () => {} }));

describe('activityLabel', () => {
  it('names each activity, and says so while a wedged turn is being waited on', () => {
    expect(activityLabel({ activity: 'thinking' })).toBe('thinking');
    expect(activityLabel({ activity: 'writing' })).toBe('writing');
    expect(activityLabel({ activity: 'waiting' })).toBe('still waiting for Codex');
    expect(activityLabel({ activity: 'tool', detail: 'web_search' })).toBe('searching the web');
    expect(activityLabel({ activity: 'tool', detail: 'x_unknown' })).toBe('running x_unknown');
  });
});

describe('ApprovalCard', () => {
  it('offers every option as a button and keeps the note field out of the way until one asks for it', () => {
    const html = card();
    expect(html).toContain('Keep these page styles?');
    expect(html).toContain('Adjust…');
    expect(html).toContain('Revert');
    expect(html).not.toContain('<textarea');
  });

  it('shows the decision and the note once it is resolved', () => {
    const html = card({ decision: 'adjust', note: 'blue, not red' });
    expect(html).toContain('adjust');
    expect(html).toContain('blue, not red');
    expect(html).not.toContain('<button');
  });
});
