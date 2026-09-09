import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface HistoryStats {
  conversations: number;
  events: number;
  posts: number;
  library: number;
  tasks: number;
  dbBytes: number;
}

/** Schema versions, applied in order and stamped into `PRAGMA user_version`. Never edit a released entry: add a new one. */
const MIGRATIONS: string[] = [
  `
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
`,
  `
ALTER TABLE tasks ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0;
`,
];

const V1_TABLES = ['posts', 'posts_fts', 'library', 'conversations', 'conversation_events', 'tasks'];

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?").get(name) !== undefined;
}

export function migrate(db: DatabaseSync): number {
  let version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  // Databases created before migrations existed carry version 0 with the v1 schema already in place.
  if (version === 0 && V1_TABLES.every((t) => tableExists(db, t))) {
    db.exec('PRAGMA user_version = 1');
    version = 1;
  }
  if (version >= MIGRATIONS.length) return version;
  const target = MIGRATIONS.length;
  try {
    db.exec('BEGIN');
    for (let v = version; v < target; v++) db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${target}`);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the failed statement may have aborted the transaction already */
    }
    throw new Error(
      `XPilot could not upgrade its history database from version ${version} to ${target}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return target;
}

/** The one connection every domain store shares: it owns the pragmas, the migrations and the file. */
export class HistoryDb {
  readonly db: DatabaseSync;

  constructor(private readonly path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    migrate(this.db);
  }

  stats(): HistoryStats {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      conversations: n('SELECT COUNT(*) AS n FROM conversations'),
      events: n('SELECT COUNT(*) AS n FROM conversation_events'),
      posts: n('SELECT COUNT(*) AS n FROM posts'),
      library: n('SELECT COUNT(*) AS n FROM library'),
      tasks: n('SELECT COUNT(*) AS n FROM tasks'),
      dbBytes: this.dbBytes(),
    };
  }

  /** The file on disk, or - for an in-memory database, and if the file cannot be read - the pages SQLite holds. */
  private dbBytes(): number {
    if (this.path !== ':memory:') {
      try {
        return statSync(this.path).size;
      } catch {
        /* fall through to the page count */
      }
    }
    const pages = (this.db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
    const size = (this.db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
    return pages * size;
  }

  close(): void {
    this.db.close();
  }
}
