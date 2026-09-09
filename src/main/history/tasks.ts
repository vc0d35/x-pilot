import type { DatabaseSync } from 'node:sqlite';
import type { ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';

/** The scheduled tasks the agent creates and `TaskManager` ticks over. */
export class TasksStore {
  constructor(private readonly db: DatabaseSync) {}

  create(t: {
    title: string;
    prompt: string;
    schedule: TaskSchedule;
    threadMode: 'resume' | 'new';
    webSearch?: boolean;
    nextRunAt: string | null;
  }): ScheduledTask {
    const res = this.db
      .prepare(
        'INSERT INTO tasks(title, prompt, schedule_json, thread_mode, web_search, created_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(t.title, t.prompt, JSON.stringify(t.schedule), t.threadMode, t.webSearch ? 1 : 0, new Date().toISOString(), t.nextRunAt);
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(
    id: number,
    patch: Partial<
      Pick<
        ScheduledTask,
        'title' | 'prompt' | 'schedule' | 'threadMode' | 'threadId' | 'enabled' | 'webSearch' | 'lastRunAt' | 'lastStatus' | 'nextRunAt'
      >
    >,
  ): void {
    const cols: Record<string, unknown> = {
      title: patch.title,
      prompt: patch.prompt,
      schedule_json: patch.schedule === undefined ? undefined : JSON.stringify(patch.schedule),
      thread_mode: patch.threadMode,
      thread_id: patch.threadId,
      enabled: patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0,
      web_search: patch.webSearch === undefined ? undefined : patch.webSearch ? 1 : 0,
      last_run_at: patch.lastRunAt,
      last_status: patch.lastStatus,
      next_run_at: patch.nextRunAt,
    };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (set.length === 0) return;
    this.db
      .prepare(`UPDATE tasks SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...set.map(([, v]) => v as string | number | null), id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  get(id: number): ScheduledTask | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToTask(r) : null;
  }

  list(): ScheduledTask[] {
    return (this.db.prepare('SELECT * FROM tasks ORDER BY id').all() as Array<Record<string, unknown>>).map(rowToTask);
  }

  due(now: string): ScheduledTask[] {
    return (
      this.db
        .prepare('SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at')
        .all(now) as Array<Record<string, unknown>>
    ).map(rowToTask);
  }
}

function rowToTask(r: Record<string, unknown>): ScheduledTask {
  return {
    id: r.id as number,
    title: r.title as string,
    prompt: r.prompt as string,
    schedule: JSON.parse(r.schedule_json as string) as TaskSchedule,
    threadMode: r.thread_mode as 'resume' | 'new',
    threadId: (r.thread_id as string | null) ?? null,
    enabled: (r.enabled as number) === 1,
    webSearch: (r.web_search as number | null) === 1,
    createdAt: r.created_at as string,
    lastRunAt: (r.last_run_at as string | null) ?? null,
    lastStatus: (r.last_status as string | null) ?? null,
    nextRunAt: (r.next_run_at as string | null) ?? null,
  };
}
