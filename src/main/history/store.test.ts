import { describe, it, expect } from 'vitest';
import { HistoryStore } from './store';
import type { Post } from '../../shared/page';

const post = (id: string, text: string, handle = 'alice', extra: Partial<Post> = {}): Post => ({
  id, url: `https://x.com/${handle}/status/${id}`, authorHandle: handle, authorName: handle.toUpperCase(), text, postedAt: null, kind: 'post', ...extra,
});

describe('HistoryStore', () => {
  it('records likes and finds them by text and author', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'Rust borrow checker tips'), '2026-09-01T00:00:00Z');
    s.recordLike(post('2', 'Electron WebContentsView guide', 'bob'), '2026-09-02T00:00:00Z');
    s.recordLike(post('3', 'More rust: lifetimes', 'bob'), '2026-09-03T00:00:00Z');
    expect(s.search({ query: 'rust' }).map((h) => h.id).sort()).toEqual(['1', '3']);
    expect(s.search({ query: 'rust', author: 'bob' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'rust', since: '2026-09-02T00:00:00Z' }).map((h) => h.id)).toEqual(['3']);
    expect(s.search({ query: 'electr' })[0].snippet).toContain('[Electron]');
    expect(s.count()).toBe(3);
  });

  it('keeps unliked posts but flags them; re-liking clears the flag', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'hello world'), '2026-09-01T00:00:00Z');
    s.recordUnlike('1', '2026-09-02T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBe('2026-09-02T00:00:00Z');
    s.recordLike(post('1', 'hello world'), '2026-09-03T00:00:00Z');
    expect(s.search({ query: 'hello' })[0].unlikedAt).toBeNull();
  });

  it('indexes article title and body', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('9', 'short teaser', 'alice', { kind: 'article', articleTitle: 'On Compilers', articleBody: 'A long essay about parsing.' }));
    const hits = s.search({ query: 'parsing' });
    expect(hits.map((h) => h.id)).toEqual(['9']);
    expect(hits[0].snippet).toContain('[parsing]');
  });

  it('survives FTS special characters in queries and clears', () => {
    const s = new HistoryStore(':memory:');
    s.recordLike(post('1', 'what is "webmcp" (really)?'));
    expect(s.search({ query: 'webmcp (really)?' }).map((h) => h.id)).toEqual(['1']);
    expect(s.search({ query: '' })).toEqual([]);
    s.clear();
    expect(s.count()).toBe(0);
  });

  it('stores and lists library items', () => {
    const s = new HistoryStore(':memory:');
    const item = s.addLibraryItem({ postId: null, url: 'https://x.com/a/status/1', path: '/tmp/a.pdf', title: 'A' });
    expect(item.id).toBe(1);
    expect(s.listLibrary()).toEqual([expect.objectContaining({ path: '/tmp/a.pdf', title: 'A' })]);
    s.clear();
    expect(s.listLibrary()).toHaveLength(1); // clear() keeps the library
  });

  it('recognises recorded library paths regardless of the current folder', () => {
    const s = new HistoryStore(':memory:');
    s.addLibraryItem({ postId: null, url: 'https://x.com/a/status/1', path: '/old/a.pdf', title: 'A' });
    expect(s.hasLibraryPath('/old/a.pdf')).toBe(true);
    expect(s.hasLibraryPath('/old/b.pdf')).toBe(false);
    expect(s.hasLibraryPath('/etc/passwd')).toBe(false);
  });
});

describe('conversations', () => {
  it('creates, titles, appends events, lists newest first', () => {
    const s = new HistoryStore(':memory:');
    s.upsertConversation({ threadId: 't1', kind: 'chat', toolsHash: 'h' });
    s.upsertConversation({ threadId: 't2', kind: 'task', taskId: 7, toolsHash: 'h' });
    s.appendEvent('t1', { type: 'user.message', text: 'Is this true? A very long question that keeps going on and on and on' });
    s.appendEvent('t1', { type: 'message.completed', itemId: 'm1', text: 'Yes' });
    const list = s.listConversations();
    expect(list.map((c) => c.threadId)).toEqual(['t1', 't2']); // t1 updated last by its events
    expect(list[0].title).toBe('Is this true? A very long question that keeps going on and o…');
    expect(list[1]).toMatchObject({ kind: 'task', taskId: 7, title: 'Task run' });
    expect(s.listEvents('t1').map((e) => e.type)).toEqual(['user.message', 'message.completed']);
    expect(s.getConversation('nope')).toBeNull();
  });
});

describe('tasks', () => {
  it('creates, lists, updates and deletes tasks', () => {
    const s = new HistoryStore(':memory:');
    const t = s.createTask({ title: 'Weather', prompt: 'Post the weather', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: '2026-09-08T10:00:00.000Z' });
    expect(t.id).toBe(1);
    expect(s.listTasks()[0]).toMatchObject({ title: 'Weather', enabled: true, schedule: { every: '1h' }, threadMode: 'resume', threadId: null, lastRunAt: null });
    s.updateTask(1, { enabled: false, threadId: 'th-1', lastRunAt: '2026-09-08T10:00:05.000Z', lastStatus: 'completed', nextRunAt: '2026-09-08T11:00:00.000Z' });
    expect(s.getTask(1)).toMatchObject({ enabled: false, threadId: 'th-1', lastStatus: 'completed', nextRunAt: '2026-09-08T11:00:00.000Z' });
    expect(s.dueTasks('2026-09-08T11:00:00.000Z')).toEqual([]); // disabled
    s.updateTask(1, { enabled: true });
    expect(s.dueTasks('2026-09-08T11:00:00.000Z').map((x) => x.id)).toEqual([1]);
    expect(s.dueTasks('2026-09-08T10:59:59.000Z')).toEqual([]);
    s.deleteTask(1);
    expect(s.listTasks()).toEqual([]);
  });
});
