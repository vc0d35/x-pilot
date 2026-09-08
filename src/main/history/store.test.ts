import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryStore, migrate } from './store';
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
    s.recordLike(post('1', 'what is "sqlite" (really)?'));
    expect(s.search({ query: 'sqlite (really)?' }).map((h) => h.id)).toEqual(['1']);
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
    expect(s.listConversations().map((c) => c.threadId)).toEqual(['t1']); // t2 has no events yet: hidden
    s.appendEvent('t2', { type: 'message.completed', itemId: 'x', text: 'ran' });
    const list = s.listConversations();
    expect(list.map((c) => c.threadId)).toEqual(['t2', 't1']);
    expect(list[1].title).toBe('Is this true? A very long question that keeps going on and o…');
    expect(list[0]).toMatchObject({ kind: 'task', taskId: 7, title: 'Task run' });
    s.upsertConversation({ threadId: 't3', kind: 'chat', toolsHash: 'h' });
    s.upsertConversation({ threadId: 't4', kind: 'chat', toolsHash: 'h' });
    s.pruneEmptyConversations('t4');
    expect(s.getConversation('t3')).toBeNull();
    expect(s.getConversation('t4')).not.toBeNull();
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

const OLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS posts(
  id TEXT PRIMARY KEY, url TEXT NOT NULL, author_handle TEXT NOT NULL, author_name TEXT NOT NULL,
  text TEXT NOT NULL, extra TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, posted_at TEXT,
  liked_at TEXT NOT NULL, unliked_at TEXT, raw_json TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(text, author_handle, author_name, extra, content='posts', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, text, author_handle, author_name, extra) VALUES (new.rowid, new.text, new.author_handle, new.author_name, new.extra);
END;
CREATE TABLE IF NOT EXISTS library(
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT, url TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations(
  thread_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'chat', task_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tools_hash TEXT
);
CREATE TABLE IF NOT EXISTS conversation_events(
  thread_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(thread_id, seq)
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, prompt TEXT NOT NULL, schedule_json TEXT NOT NULL,
  thread_mode TEXT NOT NULL DEFAULT 'resume', thread_id TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, last_run_at TEXT, last_status TEXT, next_run_at TEXT
);
`;

const userVersion = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('schema migrations', () => {
  it('stamps version 1 on a database created before migrations existed, keeping its data', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xp-db-')), 'history.sqlite');
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old.prepare('INSERT INTO posts(id, url, author_handle, author_name, text, kind, liked_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('1', 'https://x.com/a/status/1', 'alice', 'ALICE', 'kept across the upgrade', 'post', '2026-09-01T00:00:00Z', '{}');
    expect(userVersion(old)).toBe(0);
    old.close();

    const s = new HistoryStore(file);
    expect(s.count()).toBe(1);
    expect(s.search({ query: 'kept' }).map((h) => h.id)).toEqual(['1']);
    s.close();

    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(1);
    check.close();
  });

  it('creates the schema and stamps the version on a fresh database, and is a no-op when reopened', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xp-db-')), 'history.sqlite');
    const s = new HistoryStore(file);
    s.recordLike(post('1', 'hello'), '2026-09-01T00:00:00Z');
    s.close();
    const again = new HistoryStore(file);
    expect(again.count()).toBe(1);
    again.close();
    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(1);
    expect(migrate(check)).toBe(1);
    check.close();
  });

  it('throws a clear error when a migration cannot be applied', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xp-db-')), 'history.sqlite');
    new DatabaseSync(file).close();
    const db = new DatabaseSync(file, { readOnly: true });
    expect(() => migrate(db)).toThrow(/could not upgrade its history database from version 0 to 1/);
    expect(userVersion(db)).toBe(0);
    db.close();
  });

  it('exposes the tools hash a conversation was started with', () => {
    const s = new HistoryStore(':memory:');
    s.upsertConversation({ threadId: 't1', kind: 'chat', toolsHash: 'hash-a' });
    expect(s.getConversation('t1')?.toolsHash).toBe('hash-a');
    s.appendEvent('t1', { type: 'user.message', text: 'hi' });
    expect(s.listConversations()[0].toolsHash).toBe('hash-a');
  });
});
