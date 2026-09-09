import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { HistoryDb } from './db';
import { ConversationsStore } from './conversations';
import { TasksStore } from './tasks';

function open(): { db: DatabaseSync; conversations: ConversationsStore; tasks: TasksStore } {
  const db = new HistoryDb(':memory:').db;
  return { db, conversations: new ConversationsStore(db), tasks: new TasksStore(db) };
}

describe('ConversationsStore', () => {
  it('creates, titles, appends events, lists newest first', () => {
    const { conversations: s } = open();
    s.upsert({ threadId: 't1', kind: 'chat', toolsHash: 'h' });
    s.upsert({ threadId: 't2', kind: 'task', taskId: 7, toolsHash: 'h' });
    s.appendEvent('t1', { type: 'user.message', text: 'Is this true? A very long question that keeps going on and on and on' });
    s.appendEvent('t1', { type: 'message.completed', itemId: 'm1', text: 'Yes' });
    expect(s.list().map((c) => c.threadId)).toEqual(['t1']); // t2 has no events yet: hidden
    s.appendEvent('t2', { type: 'message.completed', itemId: 'x', text: 'ran' });
    const list = s.list();
    expect(list.map((c) => c.threadId)).toEqual(['t2', 't1']);
    expect(list[1].title).toBe('Is this true? A very long question that keeps going on and o…');
    expect(list[0]).toMatchObject({ kind: 'task', taskId: 7, title: 'Task run' });
    s.upsert({ threadId: 't3', kind: 'chat', toolsHash: 'h' });
    s.upsert({ threadId: 't4', kind: 'chat', toolsHash: 'h' });
    s.pruneEmpty('t4');
    expect(s.get('t3')).toBeNull();
    expect(s.get('t4')).not.toBeNull();
    expect(s.listEvents('t1').map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    expect(s.get('nope')).toBeNull();
  });

  it('exposes the tools hash a conversation was started with', () => {
    const { conversations: s } = open();
    s.upsert({ threadId: 't1', kind: 'chat', toolsHash: 'hash-a' });
    expect(s.get('t1')?.toolsHash).toBe('hash-a');
    s.appendEvent('t1', { type: 'user.message', text: 'hi' });
    expect(s.list()[0].toolsHash).toBe('hash-a');
  });
});

describe('retention', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** Conversations are written with an explicit updated_at, which upsert/appendEvent always set to now. */
  function seed(db: DatabaseSync, s: ConversationsStore, threadId: string, updatedAt: string, kind: 'chat' | 'task' = 'chat'): void {
    s.upsert({ threadId, kind, toolsHash: 'h' });
    s.appendEvent(threadId, { type: 'user.message', text: `hello from ${threadId}` });
    s.appendEvent(threadId, { type: 'message.completed', itemId: 'm', text: 'hi' });
    db.prepare('UPDATE conversations SET updated_at = ? WHERE thread_id = ?').run(updatedAt, threadId);
  }

  it('deletes conversations past the age limit with their events, and reports the counts', () => {
    const { db, conversations: s } = open();
    seed(db, s, 'old', ago(100 * DAY));
    seed(db, s, 'recent', ago(2 * DAY));
    expect(s.applyRetention({ keepConversations: 200, keepDays: 90 })).toEqual({ conversations: 1, events: 2 });
    expect(s.list().map((c) => c.threadId)).toEqual(['recent']);
    expect(s.listEvents('old')).toEqual([]);
    expect(s.applyRetention({ keepConversations: 200, keepDays: 90 })).toEqual({ conversations: 0, events: 0 });
  });

  it('keeps only the newest N, oldest first', () => {
    const { db, conversations: s } = open();
    for (let i = 0; i < 5; i++) seed(db, s, `t${i}`, ago((10 - i) * DAY));
    expect(s.applyRetention({ keepConversations: 2, keepDays: 3650 })).toMatchObject({ conversations: 3 });
    expect(s.list().map((c) => c.threadId)).toEqual(['t4', 't3']);
  });

  it('never deletes the live thread, one touched in the last hour, or a thread a task resumes', () => {
    const { db, conversations: s, tasks } = open();
    seed(db, s, 'live', ago(200 * DAY));
    seed(db, s, 'fresh', ago(10 * 60 * 1000));
    seed(db, s, 'task-thread', ago(200 * DAY), 'task');
    seed(db, s, 'stale', ago(200 * DAY));
    tasks.create({ title: 'T', prompt: 'p', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: null });
    tasks.update(1, { threadId: 'task-thread' });
    expect(s.applyRetention({ keepConversations: 1, keepDays: 30, keepThreadId: 'live' })).toMatchObject({ conversations: 1 });
    expect(s.list().map((c) => c.threadId).sort()).toEqual(['fresh', 'live', 'task-thread']);
  });
});
