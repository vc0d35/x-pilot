import { z } from 'zod';
import { defineTool, fail, ok, type ToolResult } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const attempt = (fn: () => unknown): ToolResult => {
  try {
    return ok(fn());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};
const webSearch = z.boolean().optional().describe("Allow web search during this task's runs; off unless the task needs the open web");
const threadMode = z.enum(['resume', 'new']).optional();
const schedule = z.strictObject({
  every: z.string().optional().describe('Interval: 30m, 1h, 1d (minimum 5m)'),
  cron: z.string().optional().describe('5-field cron in local time, e.g. "0 9 * * 1-5"'),
});

export const scheduleTask = defineTool({
  name: 'xpilot_schedule_task',
  description:
    'Creates a recurring task the app runs while it is open: at each scheduled time a fresh agent run receives `prompt` and acts with the same tools (posting still follows the user\'s confirm/autonomous setting). Write the prompt as complete instructions for that future run. threadMode "resume" (default) keeps one thread across runs so the task remembers what it did; "new" starts clean each time.',
  args: z.strictObject({ title: z.string(), prompt: z.string(), schedule, threadMode, webSearch }),
  execute: async (args, ctx: AppToolCtx) =>
    attempt(() =>
      ctx.tasks.create({
        title: args.title,
        prompt: args.prompt,
        schedule: args.schedule,
        threadMode: args.threadMode ?? 'resume',
        webSearch: args.webSearch === true,
      }),
    ),
});

export const listTasks = defineTool({
  name: 'xpilot_list_tasks',
  description: 'Lists the scheduled tasks with their schedule, enabled state, last run and next run.',
  args: z.strictObject({}),
  annotations: { readOnlyHint: true },
  execute: async (_args, ctx: AppToolCtx) => ok(ctx.tasks.list()),
});

export const updateTask = defineTool({
  name: 'xpilot_update_task',
  description:
    'Changes a scheduled task: enable/disable it, or update its title, prompt, schedule or threadMode. Changing the schedule or re-enabling recomputes the next run.',
  args: z.strictObject({
    id: z.int(),
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    schedule: schedule.optional(),
    threadMode,
    webSearch,
  }),
  execute: async (args, ctx: AppToolCtx) =>
    attempt(() =>
      ctx.tasks.update(args.id, {
        enabled: args.enabled,
        title: args.title,
        prompt: args.prompt,
        schedule: args.schedule,
        threadMode: args.threadMode,
        webSearch: args.webSearch,
      }),
    ),
});

export const deleteTask = defineTool({
  name: 'xpilot_delete_task',
  description: 'Deletes a scheduled task permanently.',
  args: z.strictObject({ id: z.int() }),
  annotations: { destructiveHint: true },
  execute: async (args, ctx: AppToolCtx) =>
    attempt(() => {
      const id = args.id;
      if (!ctx.tasks.get(id)) throw new Error(`No task with id ${id}`);
      ctx.tasks.delete(id);
      return { deleted: id };
    }),
});
