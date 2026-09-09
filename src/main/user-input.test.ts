import { describe, it, expect, vi } from 'vitest';
import { UserInputBroker } from './user-input';
import type { AgentEvent } from '../shared/agent';

const questions = [{ id: 'q1', prompt: 'Which account?' }, { id: 'q2', prompt: 'How fast?', options: ['fast', 'slow'] }];

describe('UserInputBroker', () => {
  it('emits a request event and resolves with the answers', async () => {
    const broker = new UserInputBroker();
    const events: AgentEvent[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request({ questions }, 1000);
    const req = (events[0] as { type: string; request: { id: string; questions: unknown[] } });
    expect(req.type).toBe('input.requested');
    expect(req.request.questions).toEqual(questions);
    expect(broker.resolve(req.request.id, { q1: '@me', q2: 'fast' })).toBe(true);
    await expect(p).resolves.toEqual({ q1: '@me', q2: 'fast' });
    expect(events[1]).toEqual({ type: 'input.resolved', id: req.request.id, answers: { q1: '@me', q2: 'fast' } });
    expect(broker.resolve(req.request.id, {})).toBe(false);
  });

  it('resolves null when the user skips, and reports an unknown id', async () => {
    const broker = new UserInputBroker();
    const events: AgentEvent[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request({ questions }, 1000);
    const id = (events[0] as { request: { id: string } }).request.id;
    expect(broker.cancel(id)).toBe(true);
    await expect(p).resolves.toBeNull();
    expect(events[1]).toEqual({ type: 'input.resolved', id, answers: null });
    expect(broker.cancel('nope')).toBe(false);
  });

  it('resolves null after the timeout and ignores answers that arrive late', async () => {
    vi.useFakeTimers();
    const broker = new UserInputBroker();
    const events: AgentEvent[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request({ questions }, 50);
    vi.advanceTimersByTime(60);
    await expect(p).resolves.toBeNull();
    expect(broker.resolve((events[0] as { request: { id: string } }).request.id, { q1: 'late' })).toBe(false);
    vi.useRealTimers();
  });

  it('cancelAll settles every outstanding question', async () => {
    const broker = new UserInputBroker();
    const p1 = broker.request({ questions }, 5000);
    const p2 = broker.request({ questions: [{ id: 'x', prompt: 'And?' }] }, 5000);
    broker.cancelAll();
    await expect(p1).resolves.toBeNull();
    await expect(p2).resolves.toBeNull();
    expect(() => broker.cancelAll()).not.toThrow();
  });

  it('stops emitting to a listener that unsubscribed', () => {
    const broker = new UserInputBroker();
    const events: AgentEvent[] = [];
    const off = broker.onEvent((e) => events.push(e));
    off();
    void broker.request({ questions }, 10);
    broker.cancelAll();
    expect(events).toEqual([]);
  });
});
