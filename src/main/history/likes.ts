import type { DatabaseSync } from 'node:sqlite';
import type { Post } from '../../shared/page';

export interface HistoryQuery {
  query: string;
  author?: string;
  since?: string;
  until?: string;
  limit?: number;
}
export interface HistoryHit {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string;
  kind: string;
  snippet: string;
  likedAt: string;
  unlikedAt: string | null;
}

/** Matching prefix terms cost seconds each in FTS5, and the query runs on the main thread. */
const MAX_FTS_TOKENS = 32;

/** Turns free text into an FTS5 query: each token becomes a quoted prefix term, ANDed together. */
export function toFtsQuery(text: string): string {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').replace(/[^\p{L}\p{N}_@#]/gu, ''))
    .filter(Boolean)
    .slice(0, MAX_FTS_TOKENS)
    .map((t) => `"${t}"*`)
    .join(' ');
}

/** Liked posts and their full-text index. */
export class LikesStore {
  constructor(private readonly db: DatabaseSync) {}

  recordLike(post: Post, likedAt = new Date().toISOString()): void {
    const extra = [post.articleTitle ?? '', post.articleBody ?? ''].filter(Boolean).join('\n');
    this.db
      .prepare(
        `
      INSERT INTO posts(id, url, author_handle, author_name, text, extra, kind, posted_at, liked_at, unliked_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, author_handle=excluded.author_handle, author_name=excluded.author_name,
        text=excluded.text, extra=CASE WHEN excluded.extra = '' THEN posts.extra ELSE excluded.extra END, kind=excluded.kind,
        posted_at=excluded.posted_at, liked_at=excluded.liked_at, unliked_at=NULL, raw_json=excluded.raw_json
    `,
      )
      .run(
        post.id,
        post.url,
        post.authorHandle,
        post.authorName,
        post.text,
        extra,
        post.kind,
        post.postedAt,
        likedAt,
        JSON.stringify(post),
      );
  }

  recordUnlike(id: string, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE posts SET unliked_at = ? WHERE id = ?').run(at, id);
  }

  search(q: HistoryQuery): HistoryHit[] {
    const match = toFtsQuery(q.query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `
      SELECT p.id, p.url, p.author_handle, p.author_name, p.kind, p.liked_at, p.unliked_at,
             snippet(posts_fts, -1, '[', ']', '…', 16) AS snippet
      FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
      WHERE posts_fts MATCH ?
        AND (? IS NULL OR p.author_handle = ?)
        AND (? IS NULL OR p.liked_at >= ?)
        AND (? IS NULL OR p.liked_at <= ?)
      ORDER BY rank, p.liked_at DESC LIMIT ?
    `,
      )
      .all(
        match,
        q.author ?? null,
        q.author ?? null,
        q.since ?? null,
        q.since ?? null,
        q.until ?? null,
        q.until ?? null,
        q.limit ?? 20,
      ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      url: r.url as string,
      authorHandle: r.author_handle as string,
      authorName: r.author_name as string,
      kind: r.kind as string,
      snippet: (r.snippet as string) || '',
      likedAt: r.liked_at as string,
      unlikedAt: (r.unliked_at as string | null) ?? null,
    }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n;
  }

  clear(): void {
    this.db.exec('DELETE FROM posts');
  }
}
