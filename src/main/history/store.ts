import { DatabaseSync } from 'node:sqlite';
import type { Post } from '../../shared/page';
import type { Conversation, LibraryItem, ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';
import type { AgentEvent } from '../../shared/agent';

export interface HistoryQuery { query: string; author?: string; since?: string; until?: string; limit?: number }
export interface HistoryHit { id: string; url: string; authorHandle: string; authorName: string; kind: string; snippet: string; likedAt: string; unlikedAt: string | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts(
  id TEXT PRIMARY KEY, url TEXT NOT NULL, author_handle TEXT NOT NULL, author_name TEXT NOT NULL,
  text TEXT NOT NULL, extra TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, posted_at TEXT,
  liked_at TEXT NOT NULL, unliked_at TEXT, raw_json TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(text, author_handle, author_name, extra, content='posts', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, text, author_handle, author_name, extra) VALUES (new.rowid, new.text, new.author_handle, new.author_name, new.extra);
END;
CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, text, author_handle, author_name, extra) VALUES ('delete', old.rowid, old.text, old.author_handle, old.author_name, old.extra);
END;
CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, text, author_handle, author_name, extra) VALUES ('delete', old.rowid, old.text, old.author_handle, old.author_name, old.extra);
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

const TITLE_MAX = 60;
/** ISO timestamps that never repeat within one process, so ordering by updated_at is deterministic. */
let lastStamp = 0;
function stamp(): string { const t = Math.max(Date.now(), lastStamp + 1); lastStamp = t; return new Date(t).toISOString(); }

const titleFrom = (text: string) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t; };

/** Turns free text into an FTS5 query: each token becomes a quoted prefix term, ANDed together. */
export function toFtsQuery(text: string): string {
  return text.split(/\s+/).map((t) => t.replace(/"/g, '').replace(/[^\p{L}\p{N}_@#]/gu, '')).filter(Boolean).map((t) => `"${t}"*`).join(' ');
}

export class HistoryStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  recordLike(post: Post, likedAt = new Date().toISOString()): void {
    const extra = [post.articleTitle ?? '', post.articleBody ?? ''].filter(Boolean).join('\n');
    this.db.prepare(`
      INSERT INTO posts(id, url, author_handle, author_name, text, extra, kind, posted_at, liked_at, unliked_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, author_handle=excluded.author_handle, author_name=excluded.author_name,
        text=excluded.text, extra=CASE WHEN excluded.extra = '' THEN posts.extra ELSE excluded.extra END, kind=excluded.kind,
        posted_at=excluded.posted_at, liked_at=excluded.liked_at, unliked_at=NULL, raw_json=excluded.raw_json
    `).run(post.id, post.url, post.authorHandle, post.authorName, post.text, extra, post.kind, post.postedAt, likedAt, JSON.stringify(post));
  }

  recordUnlike(id: string, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE posts SET unliked_at = ? WHERE id = ?').run(at, id);
  }

  search(q: HistoryQuery): HistoryHit[] {
    const match = toFtsQuery(q.query);
    if (!match) return [];
    const rows = this.db.prepare(`
      SELECT p.id, p.url, p.author_handle, p.author_name, p.kind, p.liked_at, p.unliked_at,
             snippet(posts_fts, -1, '[', ']', '…', 16) AS snippet
      FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
      WHERE posts_fts MATCH ?
        AND (? IS NULL OR p.author_handle = ?)
        AND (? IS NULL OR p.liked_at >= ?)
        AND (? IS NULL OR p.liked_at <= ?)
      ORDER BY rank, p.liked_at DESC LIMIT ?
    `).all(match, q.author ?? null, q.author ?? null, q.since ?? null, q.since ?? null, q.until ?? null, q.until ?? null, q.limit ?? 20) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string, url: r.url as string, authorHandle: r.author_handle as string, authorName: r.author_name as string,
      kind: r.kind as string, snippet: (r.snippet as string) || '', likedAt: r.liked_at as string, unlikedAt: (r.unliked_at as string | null) ?? null,
    }));
  }

  count(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n; }

  clear(): void { this.db.exec('DELETE FROM posts'); }

  addLibraryItem(i: { postId: string | null; url: string; path: string; title: string }): LibraryItem {
    const savedAt = new Date().toISOString();
    const res = this.db.prepare('INSERT INTO library(post_id, url, path, title, saved_at) VALUES (?, ?, ?, ?, ?)').run(i.postId, i.url, i.path, i.title, savedAt);
    return { id: Number(res.lastInsertRowid), url: i.url, path: i.path, title: i.title, savedAt };
  }

  /** True when this exact path was recorded as a saved library item (folder may have changed since). */
  hasLibraryPath(path: string): boolean {
    return this.db.prepare('SELECT 1 AS ok FROM library WHERE path = ? LIMIT 1').get(path) !== undefined;
  }

  listLibrary(limit = 100): LibraryItem[] {
    return (this.db.prepare('SELECT id, url, path, title, saved_at FROM library ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>)
      .map((r) => ({ id: r.id as number, url: r.url as string, path: r.path as string, title: r.title as string, savedAt: r.saved_at as string }));
  }

  // --- conversations --------------------------------------------------------------------

  upsertConversation(c: { threadId: string; kind: 'chat' | 'task'; taskId?: number | null; toolsHash: string | null }): void {
    const now = stamp();
    this.db.prepare(`INSERT INTO conversations(thread_id, title, kind, task_id, created_at, updated_at, tools_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET updated_at = excluded.updated_at, tools_hash = excluded.tools_hash`)
      .run(c.threadId, c.kind === 'task' ? 'Task run' : '', c.kind, c.taskId ?? null, now, now, c.toolsHash);
  }

  /** Appends an event to a conversation's transcript; the first user message becomes the title. */
  appendEvent(threadId: string, event: AgentEvent): void {
    const now = stamp();
    const next = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM conversation_events WHERE thread_id = ?').get(threadId) as { n: number }).n;
    this.db.prepare('INSERT INTO conversation_events(thread_id, seq, event_json) VALUES (?, ?, ?)').run(threadId, next, JSON.stringify(event));
    if (event.type === 'user.message') this.db.prepare("UPDATE conversations SET title = CASE WHEN title = '' THEN ? ELSE title END, updated_at = ? WHERE thread_id = ?").run(titleFrom(event.text), now, threadId);
    else this.db.prepare('UPDATE conversations SET updated_at = ? WHERE thread_id = ?').run(now, threadId);
  }

  listEvents(threadId: string): AgentEvent[] {
    return (this.db.prepare('SELECT event_json FROM conversation_events WHERE thread_id = ? ORDER BY seq').all(threadId) as Array<{ event_json: string }>).map((r) => JSON.parse(r.event_json) as AgentEvent);
  }

  listConversations(limit = 200): Conversation[] {
    return (this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>).map(rowToConversation);
  }

  getConversation(threadId: string): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
    return r ? rowToConversation(r) : null;
  }

  // --- scheduled tasks ------------------------------------------------------------------

  createTask(t: { title: string; prompt: string; schedule: TaskSchedule; threadMode: 'resume' | 'new'; nextRunAt: string | null }): ScheduledTask {
    const res = this.db.prepare('INSERT INTO tasks(title, prompt, schedule_json, thread_mode, created_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t.title, t.prompt, JSON.stringify(t.schedule), t.threadMode, new Date().toISOString(), t.nextRunAt);
    return this.getTask(Number(res.lastInsertRowid))!;
  }

  updateTask(id: number, patch: Partial<Pick<ScheduledTask, 'title' | 'prompt' | 'schedule' | 'threadMode' | 'threadId' | 'enabled' | 'lastRunAt' | 'lastStatus' | 'nextRunAt'>>): void {
    const cols: Record<string, unknown> = {
      title: patch.title, prompt: patch.prompt, schedule_json: patch.schedule === undefined ? undefined : JSON.stringify(patch.schedule),
      thread_mode: patch.threadMode, thread_id: patch.threadId, enabled: patch.enabled === undefined ? undefined : (patch.enabled ? 1 : 0),
      last_run_at: patch.lastRunAt, last_status: patch.lastStatus, next_run_at: patch.nextRunAt,
    };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (set.length === 0) return;
    this.db.prepare(`UPDATE tasks SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...set.map(([, v]) => v as string | number | null), id);
  }

  deleteTask(id: number): void { this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id); }

  getTask(id: number): ScheduledTask | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToTask(r) : null;
  }

  listTasks(): ScheduledTask[] {
    return (this.db.prepare('SELECT * FROM tasks ORDER BY id').all() as Array<Record<string, unknown>>).map(rowToTask);
  }

  /** Enabled tasks whose next run is at or before `now` (ISO). */
  dueTasks(now: string): ScheduledTask[] {
    return (this.db.prepare('SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(now) as Array<Record<string, unknown>>).map(rowToTask);
  }

  close(): void { this.db.close(); }
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return { threadId: r.thread_id as string, title: r.title as string, kind: r.kind as 'chat' | 'task', taskId: (r.task_id as number | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

function rowToTask(r: Record<string, unknown>): ScheduledTask {
  return {
    id: r.id as number, title: r.title as string, prompt: r.prompt as string, schedule: JSON.parse(r.schedule_json as string) as TaskSchedule,
    threadMode: r.thread_mode as 'resume' | 'new', threadId: (r.thread_id as string | null) ?? null, enabled: (r.enabled as number) === 1,
    createdAt: r.created_at as string, lastRunAt: (r.last_run_at as string | null) ?? null, lastStatus: (r.last_status as string | null) ?? null, nextRunAt: (r.next_run_at as string | null) ?? null,
  };
}
