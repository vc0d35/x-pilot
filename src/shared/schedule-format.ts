import type { TaskSchedule } from './sidebar-api';

/** How a schedule reads in the UI and in agent-facing tool output. */
export const describeSchedule = (s: TaskSchedule): string => ('every' in s ? `every ${s.every}` : `cron ${s.cron}`);
