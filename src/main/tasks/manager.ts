import type { ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';
import type { AppStore } from '../history/store';
import { nextRun, parseSchedule } from './schedule';

export type RunStatus = 'completed' | 'failed' | 'interrupted';
export type RunTask = (task: ScheduledTask) => Promise<RunStatus>;

/**
 * How far a run that would take over the user's window is pushed back when the user is at the
 * keyboard: far enough to stay out of the way, near enough that the task still happens soon.
 */
export const DEFER_MS = 2 * 60_000;

export class TaskManager {
  private queue: Promise<void> = Promise.resolve();
  /** Tasks queued or running right now, so a tick during a long run cannot enqueue them twice. */
  private readonly active = new Map<number, Promise<void>>();
  constructor(
    private readonly deps: {
      store: AppStore;
      now?: () => Date;
      run?: RunTask;
      /** True while the user is working in the app, so a run that wants their window waits. */
      userActive?: () => boolean;
    },
  ) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  create(input: {
    title: string;
    prompt: string;
    schedule: Partial<Record<'every' | 'cron', unknown>>;
    threadMode?: 'resume' | 'new';
    webSearch?: boolean;
    visibleWindow?: boolean;
  }): ScheduledTask {
    const title = input.title?.trim();
    const prompt = input.prompt?.trim();
    if (!title) throw new Error('title is required');
    if (!prompt) throw new Error('prompt is required');
    const schedule = parseSchedule(input.schedule);
    return this.deps.store.createTask({
      title,
      prompt,
      schedule,
      threadMode: input.threadMode === 'new' ? 'new' : 'resume',
      webSearch: input.webSearch === true,
      visibleWindow: input.visibleWindow === true,
      nextRunAt: nextRun(schedule, this.now()).toISOString(),
    });
  }

  update(
    id: number,
    patch: {
      title?: string;
      prompt?: string;
      schedule?: Partial<Record<'every' | 'cron', unknown>>;
      threadMode?: 'resume' | 'new';
      enabled?: boolean;
      webSearch?: boolean;
      visibleWindow?: boolean;
    },
  ): ScheduledTask {
    const current = this.deps.store.getTask(id);
    if (!current) throw new Error(`No task with id ${id}`);
    const schedule: TaskSchedule | undefined = patch.schedule ? parseSchedule(patch.schedule) : undefined;
    const reenabled = patch.enabled === true && !current.enabled;
    const nextRunAt = schedule || reenabled ? nextRun(schedule ?? current.schedule, this.now()).toISOString() : undefined;
    this.deps.store.updateTask(id, {
      title: patch.title?.trim() || undefined,
      prompt: patch.prompt?.trim() || undefined,
      schedule,
      threadMode: patch.threadMode,
      enabled: patch.enabled,
      webSearch: patch.webSearch,
      visibleWindow: patch.visibleWindow,
      nextRunAt,
    });
    return this.deps.store.getTask(id)!;
  }

  delete(id: number): void {
    this.deps.store.deleteTask(id);
  }
  get(id: number): ScheduledTask | null {
    return this.deps.store.getTask(id);
  }
  list(): ScheduledTask[] {
    return this.deps.store.listTasks();
  }

  /** Runs one task now (serialised with scheduled runs) and reschedules it. */
  runNow(id: number): Promise<void> {
    const task = this.deps.store.getTask(id);
    if (!task) throw new Error(`No task with id ${id}`);
    return this.enqueue(task, { explicit: true });
  }

  async tick(): Promise<void> {
    for (const task of this.deps.store.dueTasks(this.now().toISOString())) void this.enqueue(task).catch(() => undefined);
  }

  async idle(): Promise<void> {
    while (this.active.size > 0) await this.queue;
  }

  private enqueue(task: ScheduledTask, opts: { explicit?: boolean } = {}): Promise<void> {
    const queued = this.active.get(task.id);
    if (queued) return queued;
    // A scheduled run that drives the user's own window waits until they have stopped using it;
    // "Run now" is the user asking for it, so it never waits.
    if (task.visibleWindow && !opts.explicit && this.deps.userActive?.()) {
      this.deps.store.updateTask(task.id, {
        nextRunAt: new Date(this.now().getTime() + DEFER_MS).toISOString(),
        lastStatus: 'deferred',
      });
      return Promise.resolve();
    }
    // Reschedule at queue time, not at start: a long run must not leave the task due on every tick.
    this.deps.store.updateTask(task.id, { nextRunAt: nextRun(task.schedule, this.now()).toISOString() });
    const job = this.queue.then(async () => {
      this.deps.store.updateTask(task.id, { lastRunAt: this.now().toISOString(), lastStatus: 'running' });
      let status: RunStatus;
      try {
        status = this.deps.run ? await this.deps.run(task) : 'completed';
      } catch {
        status = 'failed';
      }
      this.deps.store.updateTask(task.id, { lastStatus: status });
    });
    const tracked = job.finally(() => {
      this.active.delete(task.id);
    });
    this.active.set(
      task.id,
      tracked.catch(() => undefined),
    );
    this.queue = tracked.catch(() => undefined);
    return job;
  }
}
