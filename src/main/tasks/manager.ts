import type { ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';
import type { HistoryStore } from '../history/store';
import { nextRun, parseSchedule } from './schedule';

export type RunStatus = 'completed' | 'failed' | 'interrupted';
export type RunTask = (task: ScheduledTask) => Promise<RunStatus>;

/** Owns the task table and decides when tasks run; the actual run is delegated to `run`. */
export class TaskManager {
  private queue: Promise<void> = Promise.resolve();
  /** Tasks queued or running right now, so a tick during a long run cannot enqueue them twice. */
  private readonly active = new Map<number, Promise<void>>();
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

  /** Called by the scheduler: queues every due task. Runs happen one at a time, in the background. */
  async tick(): Promise<void> {
    for (const task of this.deps.store.dueTasks(this.now().toISOString())) void this.enqueue(task).catch(() => undefined);
  }

  /** Resolves once nothing is queued or running. */
  async idle(): Promise<void> {
    while (this.active.size > 0) await this.queue;
  }

  private enqueue(task: ScheduledTask): Promise<void> {
    const queued = this.active.get(task.id);
    if (queued) return queued;
    // Reschedule at queue time, not at start: a long run must not leave the task due on every tick.
    this.deps.store.updateTask(task.id, { nextRunAt: nextRun(task.schedule, this.now()).toISOString() });
    const job = this.queue.then(async () => {
      this.deps.store.updateTask(task.id, { lastRunAt: this.now().toISOString(), lastStatus: 'running' });
      let status: RunStatus = 'completed';
      try { status = this.deps.run ? await this.deps.run(task) : 'completed'; }
      catch { status = 'failed'; }
      this.deps.store.updateTask(task.id, { lastStatus: status });
    });
    const tracked = job.finally(() => { this.active.delete(task.id); });
    this.active.set(task.id, tracked.catch(() => undefined));
    this.queue = tracked.catch(() => undefined);
    return job;
  }
}
