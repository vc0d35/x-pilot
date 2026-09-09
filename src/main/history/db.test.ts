import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryDb, migrate } from './db';
import { LikesStore } from './likes';
import { LibraryStore } from './library';
import { ConversationsStore } from './conversations';
import { TasksStore } from './tasks';
import type { Post } from '../../shared/page';

const post = (id: string, text: string, handle = 'alice', extra: Partial<Post> = {}): Post => ({
  id,
  url: `https://x.com/${handle}/status/${id}`,
  authorHandle: handle,
  authorName: handle.toUpperCase(),
  text,
  postedAt: null,
  kind: 'post',
  ...extra,
});

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'xp-db-')), 'history.sqlite');

/** The v1 schema exactly as the first released build wrote it, with no `user_version` stamp. */
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
    const file = tempFile();
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old
      .prepare('INSERT INTO posts(id, url, author_handle, author_name, text, kind, liked_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('1', 'https://x.com/a/status/1', 'alice', 'ALICE', 'kept across the upgrade', 'post', '2026-09-01T00:00:00Z', '{}');
    expect(userVersion(old)).toBe(0);
    old.close();

    const s = new HistoryDb(file);
    const likes = new LikesStore(s.db);
    expect(likes.count()).toBe(1);
    expect(likes.search({ query: 'kept' }).map((h) => h.id)).toEqual(['1']);
    s.close();

    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(5);
    expect(check.prepare('SELECT web_search, last_seen_post_id, visible_window FROM tasks').all()).toEqual([]); // the added columns are there
    expect(check.prepare('SELECT provider FROM conversations').all()).toEqual([]);
    check.close();
  });

  it('adds web_search to an existing v1 database, defaulting the tasks already in it to off', () => {
    const file = tempFile();
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old.exec('PRAGMA user_version = 1');
    old
      .prepare('INSERT INTO tasks(title, prompt, schedule_json, thread_mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('Weather', 'Post the weather', '{"every":"1h"}', 'resume', '2026-09-01T00:00:00Z');
    old.close();

    const s = new HistoryDb(file);
    const tasks = new TasksStore(s.db);
    expect(tasks.list()).toEqual([expect.objectContaining({ title: 'Weather', webSearch: false })]);
    tasks.update(1, { webSearch: true });
    expect(tasks.get(1)?.webSearch).toBe(true);
    s.close();

    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(5);
    check.close();
  });

  it('adds last_seen_post_id to an existing v2 database, leaving the tasks already in it unwatermarked', () => {
    const file = tempFile();
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old.exec('ALTER TABLE tasks ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0');
    old.exec('PRAGMA user_version = 2');
    old
      .prepare('INSERT INTO tasks(title, prompt, schedule_json, thread_mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('Following', 'Like technical posts', '{"every":"1h"}', 'resume', '2026-09-01T00:00:00Z');
    old.close();

    const s = new HistoryDb(file);
    const tasks = new TasksStore(s.db);
    expect(tasks.list()).toEqual([expect.objectContaining({ title: 'Following', lastSeenPostId: null })]);
    tasks.advanceLastSeenPostId(1, '1934000000000000001');
    expect(tasks.get(1)?.lastSeenPostId).toBe('1934000000000000001');
    s.close();

    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(5);
    check.close();
  });

  it('adds visible_window to an existing v3 database, leaving the tasks already in it hidden', () => {
    const file = tempFile();
    const old = new DatabaseSync(file);
    old.exec(OLD_SCHEMA);
    old.exec('ALTER TABLE tasks ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0');
    old.exec('ALTER TABLE tasks ADD COLUMN last_seen_post_id TEXT');
    old.exec('PRAGMA user_version = 3');
    old
      .prepare('INSERT INTO tasks(title, prompt, schedule_json, thread_mode, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('Morning', 'Summarise my likes', '{"every":"1d"}', 'resume', '2026-09-01T00:00:00Z');
    old.close();

    const s = new HistoryDb(file);
    const tasks = new TasksStore(s.db);
    expect(tasks.list()).toEqual([expect.objectContaining({ title: 'Morning', visibleWindow: false })]);
    tasks.update(1, { visibleWindow: true });
    expect(tasks.get(1)?.visibleWindow).toBe(true);
    s.close();

    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(5);
    check.close();
  });

  it('creates the schema and stamps the version on a fresh database, and is a no-op when reopened', () => {
    const file = tempFile();
    const s = new HistoryDb(file);
    new LikesStore(s.db).recordLike(post('1', 'hello'), '2026-09-01T00:00:00Z');
    s.close();
    const again = new HistoryDb(file);
    expect(new LikesStore(again.db).count()).toBe(1);
    again.close();
    const check = new DatabaseSync(file);
    expect(userVersion(check)).toBe(5);
    expect(migrate(check)).toBe(5);
    check.close();
  });

  it('throws a clear error when a migration cannot be applied', () => {
    const file = tempFile();
    new DatabaseSync(file).close();
    const db = new DatabaseSync(file, { readOnly: true });
    expect(() => migrate(db)).toThrow(/could not upgrade its history database from version 0 to 5/);
    expect(userVersion(db)).toBe(0);
    db.close();
  });
});

describe('stats', () => {
  it('counts every table and reports a size', () => {
    const s = new HistoryDb(':memory:');
    new LikesStore(s.db).recordLike(post('1', 'hello'));
    new LibraryStore(s.db).add({ postId: null, url: 'https://x.com/a/status/1', path: '/tmp/a.pdf', title: 'A' });
    const conversations = new ConversationsStore(s.db);
    conversations.upsert({ threadId: 't1', kind: 'chat', toolsHash: 'h' });
    conversations.appendEvent('t1', { type: 'user.message', text: 'hi' });
    new TasksStore(s.db).create({ title: 'T', prompt: 'p', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: null });
    const stats = s.stats();
    expect(stats).toMatchObject({ conversations: 1, events: 1, posts: 1, library: 1, tasks: 1 });
    expect(stats.dbBytes).toBeGreaterThan(0);
  });

  it('reports the file size for a database on disk', () => {
    const file = tempFile();
    const s = new HistoryDb(file);
    new LikesStore(s.db).recordLike(post('1', 'hello'));
    expect(s.stats().dbBytes).toBe(statSync(file).size);
    s.close();
  });
});
