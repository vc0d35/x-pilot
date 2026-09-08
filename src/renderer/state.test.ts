import { describe, it, expect } from 'vitest';
import { reduce, initialState, reportsBrokenAdapter, type State } from './state';
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

  it('reset clears entries but keeps status', () => {
    const s = run([{ type: 'status', status: 'ready' }, { type: 'user.message', text: 'x' }]);
    const r = reduce(s, { type: 'reset' });
    expect(r.entries).toEqual([]);
    expect(r.status).toBe('ready');
  });
});

it('tracks activity while running and clears it when the turn ends', () => {
  let s = run([{ type: 'turn.started', turnId: 't' }, { type: 'activity', activity: 'thinking' }]);
  expect(s.activity).toEqual({ activity: 'thinking' });
  s = run([{ type: 'activity', activity: 'tool', detail: 'web_search' }], s);
  expect(s.activity).toEqual({ activity: 'tool', detail: 'web_search' });
  s = run([{ type: 'turn.completed', turnId: 't', status: 'completed' }], s);
  expect(s.activity).toBeNull();
});

it('folds all thinking in a turn into one entry, even around tool calls', () => {
  const s = run([
    { type: 'turn.started', turnId: 't1' },
    { type: 'thinking.delta', itemId: 'r1', delta: 'Need ' },
    { type: 'thinking.delta', itemId: 'r1', delta: 'state.' },
    { type: 'tool.started', itemId: 'c1', name: 'x_get_page_state', args: {} },
    { type: 'thinking.completed', itemId: 'r1', text: 'Need state.' },
    { type: 'thinking.completed', itemId: 'c2', text: 'Now answer.' },
    { type: 'message.completed', itemId: 'm1', text: 'Done' },
    { type: 'turn.completed', turnId: 't1', status: 'completed' },
    { type: 'turn.started', turnId: 't2' },
    { type: 'thinking.completed', itemId: 'r9', text: 'Second turn' },
  ]);
  expect(s.entries.map((e) => e.kind)).toEqual(['thinking', 'tool', 'message', 'thinking']);
  expect(s.entries[0]).toEqual({ kind: 'thinking', id: 't1', steps: [{ id: 'r1', text: 'Need state.' }, { id: 'c2', text: 'Now answer.' }] });
  expect(s.entries[3]).toEqual({ kind: 'thinking', id: 't2', steps: [{ id: 'r9', text: 'Second turn' }] });
});

describe('reportsBrokenAdapter', () => {
  it('finds adapterHealthy: false wherever the tool output puts it', () => {
    expect(reportsBrokenAdapter('{"url":"https://x.com/home","adapterHealthy":false}')).toBe(true);
    expect(reportsBrokenAdapter('{"source":"visible","state":{"adapterHealthy":false}}')).toBe(true);
    expect(reportsBrokenAdapter('{"content":[{"type":"text","text":"{\\"adapterHealthy\\":false}"}]}')).toBe(true);
  });

  it('is false for healthy, unrelated, malformed and missing output', () => {
    expect(reportsBrokenAdapter('{"adapterHealthy":true}')).toBe(false);
    expect(reportsBrokenAdapter('{"note":"adapterHealthy false"}')).toBe(false);
    expect(reportsBrokenAdapter('not json at all')).toBe(false);
    expect(reportsBrokenAdapter(undefined)).toBe(false);
    expect(reportsBrokenAdapter('')).toBe(false);
  });
});
