import { describe, it, expect } from 'vitest';
import { reduce, initialState, reportsBrokenAdapter, type State } from './state';
import type { AgentEvent } from '../shared/agent';

const run = (events: AgentEvent[], s: State = initialState) => events.reduce(reduce, s);

describe('the banner over a scheduled run that has the window', () => {
  it('raises it while the run is going and takes it down when the run ends', () => {
    const started = run([{ type: 'task.run', taskId: 4, title: 'Morning scroll', visibleWindow: true, running: true }]);
    expect(started.taskRun).toEqual({ taskId: 4, title: 'Morning scroll', visibleWindow: true });
    const ended = reduce(started, { type: 'task.run', taskId: 4, title: 'Morning scroll', visibleWindow: true, running: false });
    expect(ended.taskRun).toBeNull();
  });

  it('keeps the run through a reset, because it is not part of any conversation', () => {
    const s = run([{ type: 'task.run', taskId: 4, title: 'Morning scroll', visibleWindow: true, running: true }]);
    expect(reduce(s, { type: 'reset' }).taskRun).toEqual(s.taskRun);
  });

  it('records a hidden run too, so only the banner has to decide it is not worth showing', () => {
    const s = run([{ type: 'task.run', taskId: 5, title: 'Weather', visibleWindow: false, running: true }]);
    expect(s.taskRun).toEqual({ taskId: 5, title: 'Weather', visibleWindow: false });
  });
});

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
      {
        type: 'approval.requested',
        request: { id: 'a1', kind: 'post', title: 'Post?', detail: 'hello', options: [{ id: 'post', label: 'Post' }] },
      },
      { type: 'approval.resolved', id: 'a1', decision: 'post' },
    ]);
    expect(s.entries[0]).toEqual({
      kind: 'tool',
      call: { id: 'c1', name: 'x_get_page_state', args: {}, status: 'done', output: '{"url":"u"}' },
    });
    expect(s.entries[1]).toEqual({ kind: 'approval', request: expect.objectContaining({ id: 'a1' }), decision: 'post' });
  });

  it('keeps the note the user typed on the resolved card, so the transcript shows it', () => {
    const s = run([
      {
        type: 'approval.requested',
        request: {
          id: 'a2',
          kind: 'post',
          title: 'Keep these page styles?',
          detail: 'a { color: red }',
          options: [
            { id: 'keep', label: 'Keep' },
            { id: 'adjust', label: 'Adjust…', note: true },
          ],
        },
      },
      { type: 'approval.resolved', id: 'a2', decision: 'adjust', note: 'blue, not red' },
    ]);
    expect(s.entries[0]).toMatchObject({ kind: 'approval', decision: 'adjust', note: 'blue, not red' });
  });

  it('shows a question from the agent and marks it once it is answered or skipped', () => {
    const request = { id: 'in-1', questions: [{ id: 'q1', prompt: 'Which account?' }] };
    const asked = run([{ type: 'input.requested', request }]);
    expect(asked.entries).toEqual([{ kind: 'input', request }]);
    const answered = run([{ type: 'input.resolved', id: 'in-1', answers: { q1: '@me' } }], asked);
    expect(answered.entries).toEqual([{ kind: 'input', request, resolved: { answers: { q1: '@me' } } }]);
    const skipped = run([{ type: 'input.resolved', id: 'in-1', answers: null }], asked);
    expect(skipped.entries).toEqual([{ kind: 'input', request, resolved: { answers: null } }]);
    // An answer for a question that is not on screen changes nothing.
    expect(run([{ type: 'input.resolved', id: 'other', answers: null }], asked).entries).toEqual(asked.entries);
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

  it('records a failure from a failed status and clears it on the next attempt', () => {
    let s = run([{ type: 'status', status: 'error', message: 'Codex CLI not found.' }]);
    expect(s.failure).toEqual({ message: 'Codex CLI not found.' });
    s = run([{ type: 'status', status: 'disconnected' }], s);
    expect(s.failure).toEqual({ message: 'Agent disconnected' });
    s = run([{ type: 'status', status: 'starting' }], s);
    expect(s.failure).toBeNull();
    expect(run([{ type: 'status', status: 'ready' }], s).failure).toBeNull();
  });

  it('keeps a failed turn\u2019s error as the failure, since the status goes back to ready after it', () => {
    const s = run([
      { type: 'turn.started', turnId: 't' },
      { type: 'turn.completed', turnId: 't', status: 'failed', error: 'not logged in' },
      { type: 'status', status: 'ready' },
    ]);
    expect(s.failure).toEqual({ message: 'not logged in' });
    expect(s.everSucceeded).toBe(false);
  });

  it('marks the session as succeeded and clears the failure when a turn completes', () => {
    const s = run([
      { type: 'turn.started', turnId: 't1' },
      { type: 'turn.completed', turnId: 't1', status: 'failed', error: 'boom' },
      { type: 'turn.started', turnId: 't2' },
      { type: 'turn.completed', turnId: 't2', status: 'completed' },
    ]);
    expect(s.failure).toBeNull();
    expect(s.everSucceeded).toBe(true);
  });

  it('reset clears entries but keeps status', () => {
    const s = run([
      { type: 'status', status: 'ready' },
      { type: 'user.message', text: 'x' },
    ]);
    const r = reduce(s, { type: 'reset' });
    expect(r.entries).toEqual([]);
    expect(r.status).toBe('ready');
    expect(r.failure).toBeNull();
  });
});

it('tracks activity while running and clears it when the turn ends', () => {
  let s = run([
    { type: 'turn.started', turnId: 't' },
    { type: 'activity', activity: 'thinking' },
  ]);
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
  expect(s.entries[0]).toEqual({
    kind: 'thinking',
    id: 't1',
    steps: [
      { id: 'r1', text: 'Need state.' },
      { id: 'c2', text: 'Now answer.' },
    ],
  });
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

describe('viewing a scheduled run', () => {
  const viewTask = { type: 'view.task' as const, threadId: 'run-1', taskId: 7, title: 'Weather', running: true };
  const viewing = () => reduce(initialState, viewTask);
  const streamed = (threadId: string, event: AgentEvent) => ({ type: 'conversation.event' as const, threadId, event });

  it('records the run being viewed and clears it again', () => {
    const s = viewing();
    expect(s.viewing).toEqual({ threadId: 'run-1', taskId: 7, title: 'Weather', running: true });
    expect(reduce(s, { type: 'view.live' }).viewing).toBeNull();
    expect(reduce(s, { type: 'reset' }).viewing).toBeNull();
    expect(reduce(s, { type: 'reset' }).entries).toEqual([]);
  });

  it("applies the run's events through the same reducer path as live ones", () => {
    const s = [
      streamed('run-1', { type: 'user.message', text: 'Scheduled task "Weather"' }),
      streamed('run-1', { type: 'tool.started', itemId: 'c1', name: 'x_read_timeline', args: {} }),
      streamed('run-1', { type: 'tool.completed', itemId: 'c1', name: 'x_read_timeline', success: true, output: '[]' }),
      streamed('run-1', { type: 'message.completed', itemId: 'm1', text: 'Posted.' }),
    ].reduce(reduce, viewing());
    expect(s.entries).toEqual([
      { kind: 'message', message: { id: expect.any(String), role: 'user', text: 'Scheduled task "Weather"' } },
      { kind: 'tool', call: { id: 'c1', name: 'x_read_timeline', args: {}, status: 'done', output: '[]' } },
      { kind: 'message', message: { id: 'm1', role: 'agent', text: 'Posted.', streaming: false } },
    ]);
    expect(s.viewing?.running).toBe(true);
  });

  it('ignores events for any other thread, and every event when nothing is being viewed', () => {
    const s = viewing();
    expect(reduce(s, streamed('another-run', { type: 'user.message', text: 'not mine' }))).toBe(s);
    expect(reduce(initialState, streamed('run-1', { type: 'user.message', text: 'nobody is looking' }))).toBe(initialState);
  });

  it("flips running to false on turn.completed without touching the live agent's health", () => {
    const live: State = { ...viewing(), status: 'ready', running: true, failure: { message: 'earlier' }, everSucceeded: true };
    const s = reduce(live, streamed('run-1', { type: 'turn.completed', turnId: 't', status: 'failed', error: 'boom' }));
    expect(s.viewing).toEqual({ threadId: 'run-1', taskId: 7, title: 'Weather', running: false });
    expect(s.entries.at(-1)).toEqual({ kind: 'message', message: { id: expect.any(String), role: 'system', text: 'Turn failed: boom' } });
    expect(s.status).toBe('ready');
    expect(s.running).toBe(true);
    expect(s.failure).toEqual({ message: 'earlier' });
    expect(s.everSucceeded).toBe(true);
  });
});

describe('a conversation the other backend wrote', () => {
  const viewForeign = { type: 'view.foreign' as const, threadId: 'old-1', provider: 'codex' as const };

  it('is marked read-only, and is left by going back to the live conversation', () => {
    const s = reduce(initialState, viewForeign);
    expect(s.foreign).toEqual({ threadId: 'old-1', provider: 'codex' });
    expect(reduce(s, { type: 'view.live' }).foreign).toBeNull();
    expect(reduce(s, { type: 'reset' }).foreign).toBeNull();
  });

  it('never overlaps the scheduled-run view, whichever is opened second', () => {
    const run = { type: 'view.task' as const, threadId: 'run-1', taskId: 7, title: 'Weather', running: true };
    const s = [run, viewForeign].reduce(reduce, initialState);
    expect(s.viewing).toBeNull();
    expect(s.foreign).toEqual({ threadId: 'old-1', provider: 'codex' });
    expect(reduce(s, run).foreign).toBeNull();
  });
});
