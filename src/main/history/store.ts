import { DatabaseSync } from 'node:sqlite';
import type { Post } from '../../shared/page';
import type { LibraryItem } from '../../shared/sidebar-api';

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
`;

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

  close(): void { this.db.close(); }
}
