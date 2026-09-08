import type { ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';
import type { HistoryStore } from '../history/store';
import { nextRun, parseSchedule } from './schedule';

export type RunStatus = 'completed' | 'failed' | 'interrupted';
export type RunTask = (task: ScheduledTask) => Promise<RunStatus>;

/** Owns the task table and decides when tasks run; the actual run is delegated to `run`. */
export class TaskManager {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly deps: { store: HistoryStore; now?: () => Date; run?: RunTask }) {}

  private now(): Date { return this.deps.now ? this.deps.now() : new Date(); }

  create(input: { title: string; prompt: string; schedule: Partial<Record<'every' | 'cron', unknown>>; threadMode?: 'resume' | 'new' }): ScheduledTask {
    const title = input.title?.trim();
    const prompt = input.prompt?.trim();
    if (!title) throw new Error('title is required');
    if (!prompt) throw new Error('prompt is required');
    const schedule = parseSchedule(input.schedule);
    return this.deps.store.createTask({ title, prompt, schedule, threadMode: input.threadMode === 'new' ? 'new' : 'resume', nextRunAt: nextRun(schedule, this.now()).toISOString() });
  }

  update(id: number, patch: { title?: string; prompt?: string; schedule?: Partial<Record<'every' | 'cron', unknown>>; threadMode?: 'resume' | 'new'; enabled?: boolean }): ScheduledTask {
    const current = this.deps.store.getTask(id);
    if (!current) throw new Error(`No task with id ${id}`);
    const schedule: TaskSchedule | undefined = patch.schedule ? parseSchedule(patch.schedule) : undefined;
    const reenabled = patch.enabled === true && !current.enabled;
    const nextRunAt = schedule || reenabled ? nextRun(schedule ?? current.schedule, this.now()).toISOString() : undefined;
    this.deps.store.updateTask(id, { title: patch.title?.trim() || undefined, prompt: patch.prompt?.trim() || undefined, schedule, threadMode: patch.threadMode, enabled: patch.enabled, nextRunAt });
    return this.deps.store.getTask(id)!;
  }

  delete(id: number): void { this.deps.store.deleteTask(id); }
  get(id: number): ScheduledTask | null { return this.deps.store.getTask(id); }
  list(): ScheduledTask[] { return this.deps.store.listTasks(); }

  /** Runs one task now (serialised with scheduled runs) and reschedules it. */
  runNow(id: number): Promise<void> {
    const task = this.deps.store.getTask(id);
    if (!task) throw new Error(`No task with id ${id}`);
    return this.enqueue(task);
  }

  /** Called by the scheduler: runs every due task, one at a time. */
  async tick(): Promise<void> {
    for (const task of this.deps.store.dueTasks(this.now().toISOString())) await this.enqueue(task);
  }

  private enqueue(task: ScheduledTask): Promise<void> {
    const job = this.queue.then(async () => {
      const startedAt = this.now();
      // Reschedule first so a crash mid-run cannot make the task fire again immediately.
      this.deps.store.updateTask(task.id, { lastRunAt: startedAt.toISOString(), lastStatus: 'running', nextRunAt: nextRun(task.schedule, startedAt).toISOString() });
      let status: RunStatus = 'completed';
      try { status = this.deps.run ? await this.deps.run(task) : 'completed'; }
      catch { status = 'failed'; }
      this.deps.store.updateTask(task.id, { lastStatus: status });
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
