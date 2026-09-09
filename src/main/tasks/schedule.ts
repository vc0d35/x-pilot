import { Cron } from 'croner';
import type { TaskSchedule } from '../../shared/sidebar-api';

export { describeSchedule } from '../../shared/schedule-format';

const DURATION = /^(\d+)\s*(m|h|d)$/i;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const MIN_EVERY_MS = 5 * 60_000;

export function durationMs(every: string): number {
  const m = DURATION.exec(every.trim());
  if (!m) throw new Error(`Invalid "every" value "${every}": use a number followed by m, h or d (e.g. 30m, 1h, 1d)`);
  return Number(m[1]) * UNIT_MS[m[2].toLowerCase() as keyof typeof UNIT_MS];
}

/** Validates a schedule from the agent or the UI. Throws with a message the agent can act on. */
export function parseSchedule(input: Partial<Record<'every' | 'cron', unknown>>): TaskSchedule {
  if (typeof input.every === 'string') {
    if (durationMs(input.every) < MIN_EVERY_MS) throw new Error('"every" must be at least 5 minutes');
    return { every: input.every.trim() };
  }
  if (typeof input.cron === 'string') {
    const expr = input.cron.trim();
    let cron: Cron;
    try {
      cron = new Cron(expr);
    } catch (err) {
      throw new Error(`Invalid cron expression "${expr}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    const first = cron.nextRun();
    if (!first) throw new Error(`cron "${expr}" never runs`);
    // The same 5-minute floor as "every": a cron expression is just another way to say how often.
    const second = cron.nextRun(first);
    if (second && second.getTime() - first.getTime() < MIN_EVERY_MS) throw new Error('cron must not fire more often than every 5 minutes');
    return { cron: expr };
  }
  throw new Error('schedule must be { every: "30m" | "1h" | "1d" } or { cron: "0 * * * *" }');
}

export function nextRun(schedule: TaskSchedule, from: Date): Date {
  if ('every' in schedule) return new Date(from.getTime() + durationMs(schedule.every));
  const next = new Cron(schedule.cron).nextRun(from);
  if (!next) throw new Error(`cron "${schedule.cron}" never runs`);
  return next;
}
