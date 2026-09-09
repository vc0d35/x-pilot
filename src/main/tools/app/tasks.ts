import { fail, ok, type ToolModule, type ToolResult } from '../../../shared/tools';
import type { AppToolCtx } from './context';

const attempt = (fn: () => unknown): ToolResult => { try { return ok(fn()); } catch (err) { return fail(err instanceof Error ? err.message : String(err)); } };
const webSearchDescription = "Allow web search during this task's runs; off unless the task needs the open web";
const scheduleSchema = { type: 'object', properties: { every: { type: 'string', description: 'Interval: 30m, 1h, 1d (minimum 5m)' }, cron: { type: 'string', description: '5-field cron in local time, e.g. "0 9 * * 1-5"' } }, additionalProperties: false };

export const scheduleTask: ToolModule<AppToolCtx> = {
  spec: {
    name: 'xpilot_schedule_task',
    description: 'Creates a recurring task the app runs while it is open: at each scheduled time a fresh agent run receives `prompt` and acts with the same tools (posting still follows the user\'s confirm/autonomous setting). Write the prompt as complete instructions for that future run. threadMode "resume" (default) keeps one thread across runs so the task remembers what it did; "new" starts clean each time.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, prompt: { type: 'string' }, schedule: scheduleSchema, threadMode: { type: 'string', enum: ['resume', 'new'] }, webSearch: { type: 'boolean', description: webSearchDescription } }, required: ['title', 'prompt', 'schedule'], additionalProperties: false },
  },
  execute: async (args, ctx) => attempt(() => ctx.tasks.create({ title: String(args.title ?? ''), prompt: String(args.prompt ?? ''), schedule: (args.schedule as Record<string, unknown>) ?? {}, threadMode: args.threadMode === 'new' ? 'new' : 'resume', webSearch: args.webSearch === true })),
};

export const listTasks: ToolModule<AppToolCtx> = {
  spec: { name: 'xpilot_list_tasks', description: 'Lists the scheduled tasks with their schedule, enabled state, last run and next run.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  execute: async (_args, ctx) => ok(ctx.tasks.list()),
};

export const updateTask: ToolModule<AppToolCtx> = {
  spec: {
    name: 'xpilot_update_task',
    description: 'Changes a scheduled task: enable/disable it, or update its title, prompt, schedule or threadMode. Changing the schedule or re-enabling recomputes the next run.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, enabled: { type: 'boolean' }, title: { type: 'string' }, prompt: { type: 'string' }, schedule: scheduleSchema, threadMode: { type: 'string', enum: ['resume', 'new'] }, webSearch: { type: 'boolean', description: webSearchDescription } }, required: ['id'], additionalProperties: false },
  },
  execute: async (args, ctx) => attempt(() => ctx.tasks.update(Number(args.id), {
    enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined, title: typeof args.title === 'string' ? args.title : undefined,
    prompt: typeof args.prompt === 'string' ? args.prompt : undefined, schedule: args.schedule as Record<string, unknown> | undefined,
    threadMode: args.threadMode === 'new' || args.threadMode === 'resume' ? args.threadMode : undefined,
    webSearch: typeof args.webSearch === 'boolean' ? args.webSearch : undefined,
  })),
};

export const deleteTask: ToolModule<AppToolCtx> = {
  spec: { name: 'xpilot_delete_task', description: 'Deletes a scheduled task permanently.', inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false }, annotations: { destructiveHint: true } },
  execute: async (args, ctx) => attempt(() => { const id = Number(args.id); if (!ctx.tasks.get(id)) throw new Error(`No task with id ${id}`); ctx.tasks.delete(id); return { deleted: id }; }),
};
