import type { DatabaseSync } from 'node:sqlite';
import type { AgentEvent } from '../../shared/agent';
import type { Conversation } from '../../shared/sidebar-api';

export interface RetentionPolicy {
  keepConversations: number;
  keepDays: number;
  /** The live thread, which is never deleted however old it looks. */
  keepThreadId?: string | null;
}
export interface RetentionResult { conversations: number; events: number }

const TITLE_MAX = 60;
/** ISO timestamps that never repeat within one process, so ordering by updated_at is deterministic. */
let lastStamp = 0;
function stamp(): string { const t = Math.max(Date.now(), lastStamp + 1); lastStamp = t; return new Date(t).toISOString(); }

const titleFrom = (text: string) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t; };

/** A conversation touched this recently is in use, so retention leaves it alone. */
const RETENTION_GRACE_MS = 60 * 60 * 1000;

/** Conversations, their event transcripts, and the retention policy over both. */
export class ConversationsStore {
  constructor(private readonly db: DatabaseSync) {}

  upsert(c: { threadId: string; kind: 'chat' | 'task'; taskId?: number | null; toolsHash: string | null }): void {
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

  /** Conversations that have at least one recorded event; empty (never used) threads are not shown. */
  list(limit = 200): Conversation[] {
    return (this.db.prepare(`SELECT c.* FROM conversations c WHERE EXISTS (SELECT 1 FROM conversation_events e WHERE e.thread_id = c.thread_id)
      ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>).map(rowToConversation);
  }

  pruneEmpty(exceptThreadId: string | null): void {
    this.db.prepare(`DELETE FROM conversations WHERE (? IS NULL OR thread_id <> ?) AND NOT EXISTS (SELECT 1 FROM conversation_events e WHERE e.thread_id = conversations.thread_id)`).run(exceptThreadId, exceptThreadId);
  }

  get(threadId: string): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
    return r ? rowToConversation(r) : null;
  }

  /**
   * Deletes conversations past either limit and their events. A conversation is kept when it is
   * the live thread, when it was touched in the last hour, or when a scheduled task resumes it:
   * retention must never break a thread the app is still using.
   */
  applyRetention(policy: RetentionPolicy): RetentionResult {
    const cutoff = new Date(Date.now() - policy.keepDays * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - RETENTION_GRACE_MS).toISOString();
    const victims = (this.db.prepare(`
      WITH ranked AS (SELECT thread_id, updated_at, ROW_NUMBER() OVER (ORDER BY updated_at DESC, rowid DESC) AS rn FROM conversations)
      SELECT thread_id FROM ranked
      WHERE (rn > ? OR updated_at < ?)
        AND updated_at < ?
        AND (? IS NULL OR thread_id <> ?)
        AND thread_id NOT IN (SELECT thread_id FROM tasks WHERE thread_id IS NOT NULL)
    `).all(policy.keepConversations, cutoff, recent, policy.keepThreadId ?? null, policy.keepThreadId ?? null) as Array<{ thread_id: string }>).map((r) => r.thread_id);
    if (victims.length === 0) return { conversations: 0, events: 0 };
    const holes = victims.map(() => '?').join(', ');
    const events = (this.db.prepare(`SELECT COUNT(*) AS n FROM conversation_events WHERE thread_id IN (${holes})`).get(...victims) as { n: number }).n;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM conversation_events WHERE thread_id IN (${holes})`).run(...victims);
      this.db.prepare(`DELETE FROM conversations WHERE thread_id IN (${holes})`).run(...victims);
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* the failed statement may have aborted the transaction already */ }
      throw err;
    }
    return { conversations: victims.length, events };
  }
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return { threadId: r.thread_id as string, title: r.title as string, kind: r.kind as 'chat' | 'task', taskId: (r.task_id as number | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string, toolsHash: (r.tools_hash as string | null) ?? null };
}
