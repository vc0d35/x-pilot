import { describe, it, expect, vi } from 'vitest';
import { TaskRunner, buildRunPrompt } from './runner';
import { HistoryStore } from '../history/store';
import type { AgentProvider, StartOptions } from '../agent/provider';
import type { AgentEvent } from '../../shared/agent';
import { DEFAULT_SETTINGS } from '../../shared/settings';

function fakeProvider(threadId = 'task-thread', outcome: AgentEvent[] = [{ type: 'turn.completed', turnId: 't', status: 'completed' }]) {
  const listeners = new Set<(e: AgentEvent) => void>();
  const p: AgentProvider & { starts: StartOptions[]; sent: string[] } = {
    id: 'fake', starts: [], sent: [],
    start: vi.fn(async (o: StartOptions) => { p.starts.push(o); return { threadId }; }),
    send: vi.fn(async (text: string) => { p.sent.push(text); setTimeout(() => { for (const e of [{ type: 'user.message', text } as AgentEvent, { type: 'message.completed', itemId: 'm', text: 'done' } as AgentEvent, ...outcome]) for (const l of listeners) l(e); }, 5); }),
    interrupt: vi.fn(async () => {}), listModels: vi.fn(async () => []), onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); }, isRunning: () => false, stop: vi.fn(async () => {}),
  };
  return p;
}

const task = { id: 3, title: 'Weather', prompt: 'Post the Amsterdam weather', schedule: { every: '1h' as const }, threadMode: 'resume' as const, threadId: null, enabled: true, createdAt: '', lastRunAt: null, lastStatus: null, nextRunAt: null };

describe('TaskRunner', () => {
  it('runs on a fresh provider, records a task conversation, stores the thread for resume, and stops', async () => {
    const store = new HistoryStore(':memory:');
    const p = fakeProvider();
    const r = new TaskRunner({ createProvider: () => p, tools: () => [], settings: () => DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp', store, timeoutMs: 2000 });
    expect(await r.run(task)).toBe('completed');
    expect(p.starts[0].threadId).toBeNull();
    expect(p.sent[0]).toContain('Post the Amsterdam weather');
    expect(p.stop).toHaveBeenCalled();
    expect(store.getTask(3)).toBeNull(); // the runner does not own the task row...
    expect(store.listConversations()[0]).toMatchObject({ threadId: 'task-thread', kind: 'task', taskId: 3 });
    expect(store.listEvents('task-thread').map((e) => e.type)).toEqual(['user.message', 'message.completed', 'turn.completed']);
    expect(r.lastThreadId).toBe('task-thread'); // ...but reports the thread to resume next time
  });
  it('resumes the task thread in resume mode and starts fresh in new mode', async () => {
    const store = new HistoryStore(':memory:');
    const p = fakeProvider();
    const r = new TaskRunner({ createProvider: () => p, tools: () => [], settings: () => DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp', store, timeoutMs: 2000 });
    await r.run({ ...task, threadId: 'old' });
    expect(p.starts[0].threadId).toBe('old');
    await r.run({ ...task, threadId: 'old', threadMode: 'new' });
    expect(p.starts[1].threadId).toBeNull();
  });
  it('reports failed turns and times out hung runs', async () => {
    const store = new HistoryStore(':memory:');
    const failing = fakeProvider('t2', [{ type: 'turn.completed', turnId: 't', status: 'failed', error: 'boom' }]);
    const r = new TaskRunner({ createProvider: () => failing, tools: () => [], settings: () => DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp', store, timeoutMs: 2000 });
    expect(await r.run(task)).toBe('failed');
    const hung = fakeProvider('t3', []);
    const r2 = new TaskRunner({ createProvider: () => hung, tools: () => [], settings: () => DEFAULT_SETTINGS.agent.codex, workspaceDir: '/tmp', store, timeoutMs: 50 });
    expect(await r2.run(task)).toBe('interrupted');
    expect(hung.interrupt).toHaveBeenCalled();
    expect(hung.stop).toHaveBeenCalled();
  });
});

describe('buildRunPrompt', () => {
  it('prefixes a scheduled-run hint with the last run time', () => {
    expect(buildRunPrompt(task, null)).toBe('Scheduled task "Weather" (every 1h), first run. Do the task below without asking questions; the user is not watching.\n\nPost the Amsterdam weather');
    expect(buildRunPrompt({ ...task, lastRunAt: '2026-09-08T10:00:00.000Z' }, '2026-09-08T10:00:00.000Z')).toContain('last run 2026-09-08T10:00:00.000Z');
  });
});
