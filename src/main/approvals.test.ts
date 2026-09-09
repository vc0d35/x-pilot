import { describe, it, expect, vi } from 'vitest';
import { ApprovalBroker } from './approvals';

describe('ApprovalBroker', () => {
  it('emits a request event and resolves with the decision', async () => {
    const broker = new ApprovalBroker();
    const events: unknown[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request(
      {
        kind: 'post',
        title: 'Post?',
        detail: 'hello',
        options: [
          { id: 'post', label: 'Post' },
          { id: 'cancel', label: 'Cancel' },
        ],
      },
      1000,
    );
    const req = (events[0] as { request: { id: string } }).request;
    expect(broker.resolve(req.id, 'post')).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'post' });
    expect(events[1]).toEqual({ type: 'approval.resolved', id: req.id, decision: 'post' });
  });

  it('carries the note the user typed to the waiting tool and into the transcript', async () => {
    const broker = new ApprovalBroker();
    const events: unknown[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request(
      {
        kind: 'post',
        title: 'Keep these page styles?',
        detail: 'a { color: red }',
        options: [
          { id: 'keep', label: 'Keep' },
          { id: 'adjust', label: 'Adjust…', note: true },
        ],
      },
      1000,
    );
    const req = (events[0] as { request: { id: string } }).request;
    expect(broker.resolve(req.id, 'adjust', 'make it blue instead')).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'adjust', note: 'make it blue instead' });
    expect(events[1]).toEqual({ type: 'approval.resolved', id: req.id, decision: 'adjust', note: 'make it blue instead' });
  });

  it('resolves "timeout" after the timeout and ignores late resolves', async () => {
    vi.useFakeTimers();
    const broker = new ApprovalBroker();
    const p = broker.request({ kind: 'command', title: 't', detail: 'd', options: [] }, 50);
    vi.advanceTimersByTime(60);
    await expect(p).resolves.toEqual({ decision: 'timeout' });
    expect(broker.resolve('whatever', 'accept')).toBe(false);
    vi.useRealTimers();
  });

  it('cancelAll resolves every outstanding request with the given decision', async () => {
    const broker = new ApprovalBroker();
    const events: unknown[] = [];
    broker.onEvent((e) => events.push(e));
    const p1 = broker.request({ kind: 'command', title: 't1', detail: 'd1', options: [] }, 5000);
    const p2 = broker.request({ kind: 'fileChange', title: 't2', detail: 'd2', options: [] }, 5000);
    broker.cancelAll('cancel');
    await expect(p1).resolves.toEqual({ decision: 'cancel' });
    await expect(p2).resolves.toEqual({ decision: 'cancel' });
    const resolvedEvents = events.filter((e) => (e as { type: string }).type === 'approval.resolved');
    expect(resolvedEvents).toHaveLength(2);
    expect(resolvedEvents.every((e) => (e as { decision: string }).decision === 'cancel')).toBe(true);
    expect(() => broker.cancelAll()).not.toThrow();
  });
});
