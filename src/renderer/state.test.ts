import { describe, it, expect } from 'vitest';
import { reduce, initialState, type State } from './state';
import type { AgentEvent } from '../shared/agent';

const run = (events: AgentEvent[], s: State = initialState) => events.reduce(reduce, s);

describe('sidebar reducer', () => {
  it('streams an agent message from deltas and finalises it', () => {
    const s = run([
      { type: 'user.message', text: 'hi' },
      { type: 'turn.started', turnId: 't1' },
      { type: 'message.delta', itemId: 'm1', delta: 'Hel' },
      { type: 'message.delta', itemId: 'm1', delta: 'lo' },
      { type: 'message.completed', itemId: 'm1', text: 'Hello' },
      { type: 'turn.completed', turnId: 't1', status: 'completed' },
    ]);
    expect(s.entries).toEqual([
      { kind: 'message', message: { id: expect.any(String), role: 'user', text: 'hi' } },
      { kind: 'message', message: { id: 'm1', role: 'agent', text: 'Hello', streaming: false } },
    ]);
    expect(s.running).toBe(false);
  });

  it('tracks tool calls and approvals', () => {
    const s = run([
      { type: 'tool.started', itemId: 'c1', name: 'x_get_page_state', args: {} },
      { type: 'tool.completed', itemId: 'c1', name: 'x_get_page_state', success: true, output: '{"url":"u"}' },
      { type: 'approval.requested', request: { id: 'a1', kind: 'post', title: 'Post?', detail: 'hello', options: [{ id: 'post', label: 'Post' }] } },
      { type: 'approval.resolved', id: 'a1', decision: 'post' },
    ]);
    expect(s.entries[0]).toEqual({ kind: 'tool', call: { id: 'c1', name: 'x_get_page_state', args: {}, status: 'done', output: '{"url":"u"}' } });
    expect(s.entries[1]).toEqual({ kind: 'approval', request: expect.objectContaining({ id: 'a1' }), decision: 'post' });
  });

  it('records status, thread and failed turns', () => {
    const s = run([
      { type: 'status', status: 'error', message: 'codex missing' },
      { type: 'thread', threadId: 'th' },
      { type: 'turn.started', turnId: 't' },
      { type: 'turn.completed', turnId: 't', status: 'failed', error: 'boom' },
    ]);
    expect(s.status).toBe('error');
    expect(s.statusMessage).toBe('codex missing');
    expect(s.threadId).toBe('th');
    expect(s.entries.at(-1)).toEqual({ kind: 'message', message: { id: expect.any(String), role: 'system', text: 'Turn failed: boom' } });
  });
});
