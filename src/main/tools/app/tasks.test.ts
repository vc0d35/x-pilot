import { describe, it, expect } from 'vitest';
import { scheduleTask, listTasks, updateTask, deleteTask } from './tasks';
import { TaskManager } from '../../tasks/manager';
import { HistoryStore } from '../../history/store';
import { fail } from '../../../shared/tools';

function ctx() {
  const history = new HistoryStore(':memory:');
  const tasks = new TaskManager({ store: history, now: () => new Date('2026-09-08T10:00:00.000Z') });
  return { history, tasks, libraryDir: () => '/lib', exportPdf: async () => ({ path: '', title: '' }), openPath: async () => '' };
}

describe('task tools', () => {
  it('schedules, lists, updates and deletes through the manager', async () => {
    const c = ctx();
    const r = (await scheduleTask.execute({ title: 'Weather', prompt: 'Post the weather for Amsterdam', schedule: { every: '1h' } }, c)) as { success: true; content: { id: number; nextRunAt: string } };
    expect(r.success).toBe(true);
    expect(r.content).toMatchObject({ id: 1, nextRunAt: '2026-09-08T11:00:00.000Z', threadMode: 'resume' });
    expect(((await listTasks.execute({}, c)) as { content: unknown[] }).content).toHaveLength(1);
    expect(await updateTask.execute({ id: 1, enabled: false }, c)).toMatchObject({ success: true, content: { enabled: false } });
    expect(await deleteTask.execute({ id: 1 }, c)).toEqual({ success: true, content: { deleted: 1 } });
    expect(((await listTasks.execute({}, c)) as { content: unknown[] }).content).toHaveLength(0);
  });
  it('carries the web-search flag from the agent, defaulting it off', async () => {
    const c = ctx();
    const off = (await scheduleTask.execute({ title: 'A', prompt: 'p', schedule: { every: '1h' } }, c)) as { content: { id: number; webSearch: boolean } };
    expect(off.content.webSearch).toBe(false);
    const on = (await scheduleTask.execute({ title: 'B', prompt: 'p', schedule: { every: '1h' }, webSearch: true }, c)) as { content: { webSearch: boolean } };
    expect(on.content.webSearch).toBe(true);
    expect(await updateTask.execute({ id: off.content.id, webSearch: true }, c)).toMatchObject({ success: true, content: { webSearch: true } });
    expect(scheduleTask.spec.inputSchema.properties).toHaveProperty('webSearch');
    expect(updateTask.spec.inputSchema.properties).toHaveProperty('webSearch');
  });
  it('turns validation errors into tool failures the agent can act on', async () => {
    const c = ctx();
    expect(await scheduleTask.execute({ title: 'x', prompt: 'y', schedule: { every: '1m' } }, c)).toEqual(fail('"every" must be at least 5 minutes'));
    expect(await updateTask.execute({ id: 42, enabled: true }, c)).toEqual(fail('No task with id 42'));
  });
});
