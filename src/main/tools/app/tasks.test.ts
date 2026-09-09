import { describe, it, expect } from 'vitest';
import { scheduleTask, listTasks, updateTask, deleteTask } from './tasks';
import { TaskManager } from '../../tasks/manager';
import { AppStore } from '../../history/store';
import type { PageStyles } from '../../page-config/styles';
import type { SelectorOverrides } from '../../page-config/selectors';
import type { ApprovalBroker } from '../../approvals';
import { fail } from '../../../shared/tools';

function ctx() {
  const store = new AppStore(':memory:');
  const tasks = new TaskManager({ store, now: () => new Date('2026-09-08T10:00:00.000Z') });
  const styles = {
    path: '/profile/page-styles.css',
    get: () => '',
    set: () => ({ ok: true, bytes: 0 }),
    reset: () => {},
  } as unknown as PageStyles;
  const selectors = { path: '/profile/selectors.json', list: () => [], effective: () => ({}) } as unknown as SelectorOverrides;
  return {
    store,
    tasks,
    styles,
    selectors,
    approvals: { request: async () => 'apply' } as unknown as ApprovalBroker,
    stylesMode: () => 'confirm' as const,
    testSelector: null,
    libraryDir: () => '/lib',
    exportPdf: async () => ({ path: '', title: '' }),
    openPath: async () => '',
  };
}

describe('task tools', () => {
  it('schedules, lists, updates and deletes through the manager', async () => {
    const c = ctx();
    const r = (await scheduleTask.execute(
      { title: 'Weather', prompt: 'Post the weather for Amsterdam', schedule: { every: '1h' } },
      c,
    )) as { success: true; content: { id: number; nextRunAt: string } };
    expect(r.success).toBe(true);
    expect(r.content).toMatchObject({ id: 1, nextRunAt: '2026-09-08T11:00:00.000Z', threadMode: 'resume' });
    expect(((await listTasks.execute({}, c)) as { content: unknown[] }).content).toHaveLength(1);
    expect(await updateTask.execute({ id: 1, enabled: false }, c)).toMatchObject({ success: true, content: { enabled: false } });
    expect(await deleteTask.execute({ id: 1 }, c)).toEqual({ success: true, content: { deleted: 1 } });
    expect(((await listTasks.execute({}, c)) as { content: unknown[] }).content).toHaveLength(0);
  });
  it('carries the web-search flag from the agent, defaulting it off', async () => {
    const c = ctx();
    const off = (await scheduleTask.execute({ title: 'A', prompt: 'p', schedule: { every: '1h' } }, c)) as {
      content: { id: number; webSearch: boolean };
    };
    expect(off.content.webSearch).toBe(false);
    const on = (await scheduleTask.execute({ title: 'B', prompt: 'p', schedule: { every: '1h' }, webSearch: true }, c)) as {
      content: { webSearch: boolean };
    };
    expect(on.content.webSearch).toBe(true);
    expect(await updateTask.execute({ id: off.content.id, webSearch: true }, c)).toMatchObject({
      success: true,
      content: { webSearch: true },
    });
    expect(scheduleTask.spec.inputSchema.properties).toHaveProperty('webSearch');
    expect(updateTask.spec.inputSchema.properties).toHaveProperty('webSearch');
  });
  it('carries the visible-window flag, defaulting it off, and says when to set it', async () => {
    const c = ctx();
    const hidden = (await scheduleTask.execute({ title: 'A', prompt: 'p', schedule: { every: '1h' } }, c)) as {
      content: { id: number; visibleWindow: boolean };
    };
    expect(hidden.content.visibleWindow).toBe(false);
    const onScreen = (await scheduleTask.execute({ title: 'B', prompt: 'p', schedule: { every: '1h' }, visibleWindow: true }, c)) as {
      content: { visibleWindow: boolean };
    };
    expect(onScreen.content.visibleWindow).toBe(true);
    expect(await updateTask.execute({ id: hidden.content.id, visibleWindow: true }, c)).toMatchObject({
      success: true,
      content: { visibleWindow: true },
    });
    for (const spec of [scheduleTask.spec, updateTask.spec]) {
      const arg = (spec.inputSchema.properties as { visibleWindow?: { description?: string } }).visibleWindow;
      expect(arg?.description).toMatch(/only set it when the user explicitly asked/i);
      expect(arg?.description).toMatch(/on my screen/i);
    }
    expect(listTasks.spec.description).toMatch(/visibleWindow/);
  });

  it('turns validation errors into tool failures the agent can act on', async () => {
    const c = ctx();
    expect(await scheduleTask.execute({ title: 'x', prompt: 'y', schedule: { every: '1m' } }, c)).toEqual(
      fail('"every" must be at least 5 minutes'),
    );
    expect(await updateTask.execute({ id: 42, enabled: true }, c)).toEqual(fail('No task with id 42'));
  });
});
