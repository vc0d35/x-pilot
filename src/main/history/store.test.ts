import { describe, it, expect } from 'vitest';
import { AppStore, HistoryStore } from './store';
import type { Post } from '../../shared/page';

const post = (id: string, text: string): Post => ({
  id, url: `https://x.com/alice/status/${id}`, authorHandle: 'alice', authorName: 'ALICE', text, postedAt: null, kind: 'post',
});

describe('AppStore', () => {
  it('delegates the flat method surface to the four domain stores', () => {
    const s = new AppStore(':memory:');
    s.recordLike(post('1', 'hello world'), '2026-09-01T00:00:00Z');
    s.recordUnlike('1', '2026-09-02T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
    expect(s.count()).toBe(1);

    expect(s.addLibraryItem({ postId: null, url: 'https://x.com/a/status/1', path: '/tmp/a.pdf', title: 'A' }).id).toBe(1);
    expect(s.hasLibraryPath('/tmp/a.pdf')).toBe(true);
    expect(s.listLibrary()).toHaveLength(1);

    s.upsertConversation({ threadId: 't1', kind: 'chat', toolsHash: 'h' });
    s.appendEvent('t1', { type: 'user.message', text: 'hi' });
    expect(s.listEvents('t1')).toHaveLength(1);
    expect(s.listConversations().map((c) => c.threadId)).toEqual(['t1']);
    expect(s.getConversation('t1')?.title).toBe('hi');
    s.upsertConversation({ threadId: 't2', kind: 'chat', toolsHash: 'h' });
    s.pruneEmptyConversations(null);
    expect(s.getConversation('t2')).toBeNull();
    expect(s.applyRetention({ keepConversations: 200, keepDays: 90 })).toEqual({ conversations: 0, events: 0 });

    expect(s.createTask({ title: 'T', prompt: 'p', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: '2026-09-08T10:00:00.000Z' }).id).toBe(1);
    s.updateTask(1, { lastStatus: 'completed' });
    expect(s.getTask(1)?.lastStatus).toBe('completed');
    expect(s.listTasks()).toHaveLength(1);
    expect(s.dueTasks('2026-09-08T11:00:00.000Z').map((t) => t.id)).toEqual([1]);

    expect(s.stats()).toMatchObject({ conversations: 1, events: 1, posts: 1, library: 1, tasks: 1 });

    s.clear();
    expect(s.count()).toBe(0);
    expect(s.listLibrary()).toHaveLength(1); // clear() keeps the library
    s.close();
  });

  it('shares one connection with the domain stores, and is still exported as HistoryStore', () => {
    const s = new AppStore(':memory:');
    s.likes.recordLike(post('1', 'shared connection'), '2026-09-01T00:00:00Z');
    expect(s.search({ query: 'shared' }).map((h) => h.id)).toEqual(['1']);
    s.tasks.create({ title: 'T', prompt: 'p', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: null });
    expect(s.listTasks()).toHaveLength(1);
    expect(s.conversations).toBeDefined();
    expect(s.library).toBeDefined();
    expect(new HistoryStore(':memory:')).toBeInstanceOf(AppStore);
  });
});
