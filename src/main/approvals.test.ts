import { describe, it, expect, vi } from 'vitest';
import { ApprovalBroker } from './approvals';

describe('ApprovalBroker', () => {
  it('emits a request event and resolves with the decision', async () => {
    const broker = new ApprovalBroker();
    const events: unknown[] = [];
    broker.onEvent((e) => events.push(e));
    const p = broker.request({ kind: 'post', title: 'Post?', detail: 'hello', options: [{ id: 'post', label: 'Post' }, { id: 'cancel', label: 'Cancel' }] }, 1000);
    const req = (events[0] as { request: { id: string } }).request;
    expect(broker.resolve(req.id, 'post')).toBe(true);
    await expect(p).resolves.toBe('post');
    expect(events[1]).toEqual({ type: 'approval.resolved', id: req.id, decision: 'post' });
  });

  it('resolves "timeout" after the timeout and ignores late resolves', async () => {
    vi.useFakeTimers();
    const broker = new ApprovalBroker();
    const p = broker.request({ kind: 'command', title: 't', detail: 'd', options: [] }, 50);
    vi.advanceTimersByTime(60);
    await expect(p).resolves.toBe('timeout');
    expect(broker.resolve('whatever', 'accept')).toBe(false);
    vi.useRealTimers();
  });
});
