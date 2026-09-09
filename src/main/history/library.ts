import type { DatabaseSync } from 'node:sqlite';
import type { LibraryItem } from '../../shared/sidebar-api';

/** The PDFs saved out of the page, recorded by the path they were written to. */
export class LibraryStore {
  constructor(private readonly db: DatabaseSync) {}

  add(i: { postId: string | null; url: string; path: string; title: string }): LibraryItem {
    const savedAt = new Date().toISOString();
    const res = this.db
      .prepare('INSERT INTO library(post_id, url, path, title, saved_at) VALUES (?, ?, ?, ?, ?)')
      .run(i.postId, i.url, i.path, i.title, savedAt);
    return { id: Number(res.lastInsertRowid), url: i.url, path: i.path, title: i.title, savedAt };
  }

  hasPath(path: string): boolean {
    return this.db.prepare('SELECT 1 AS ok FROM library WHERE path = ? LIMIT 1').get(path) !== undefined;
  }

  list(limit = 100): LibraryItem[] {
    return (
      this.db.prepare('SELECT id, url, path, title, saved_at FROM library ORDER BY id DESC LIMIT ?').all(limit) as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      id: r.id as number,
      url: r.url as string,
      path: r.path as string,
      title: r.title as string,
      savedAt: r.saved_at as string,
    }));
  }
}
