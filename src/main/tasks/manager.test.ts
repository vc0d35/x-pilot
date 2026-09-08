import { describe, it, expect, vi } from 'vitest';
import { TaskManager } from './manager';
import { HistoryStore } from '../history/store';

const now = new Date('2026-09-08T10:00:00.000Z');

describe('TaskManager', () => {
  it('creates a task with its first run computed from now', () => {
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => now });
    const t = m.create({ title: 'Weather', prompt: 'Post it', schedule: { every: '1h' } });
    expect(t).toMatchObject({ title: 'Weather', threadMode: 'resume', enabled: true, nextRunAt: '2026-09-08T11:00:00.000Z' });
    expect(() => m.create({ title: '', prompt: 'x', schedule: { every: '1h' } })).toThrow(/title/);
    expect(() => m.create({ title: 't', prompt: '', schedule: { every: '1h' } })).toThrow(/prompt/);
  });
  it('recomputes the next run when the schedule changes or the task is re-enabled', () => {
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => now });
    const t = m.create({ title: 'W', prompt: 'p', schedule: { every: '1h' } });
    m.update(t.id, { schedule: { every: '2h' } });
    expect(m.get(t.id)?.nextRunAt).toBe('2026-09-08T12:00:00.000Z');
    m.update(t.id, { enabled: false });
    expect(m.get(t.id)?.enabled).toBe(false);
    m.update(t.id, { enabled: true });
    expect(m.get(t.id)?.nextRunAt).toBe('2026-09-08T12:00:00.000Z'); // re-enabled: next run from now with the current 2h schedule
    expect(() => m.update(99, { enabled: true })).toThrow(/No task/);
  });
  it('runNow asks the runner immediately and records the outcome', async () => {
    const run = vi.fn(async () => 'completed' as const);
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => now, run });
    const t = m.create({ title: 'W', prompt: 'p', schedule: { every: '1h' } });
    await m.runNow(t.id);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: t.id }));
    expect(m.get(t.id)).toMatchObject({ lastStatus: 'completed', lastRunAt: now.toISOString(), nextRunAt: '2026-09-08T11:00:00.000Z' });
  });
  it('tick runs due tasks once, serially, and reschedules them', async () => {
    let clock = now;
    const order: number[] = [];
    const run = vi.fn(async (t: { id: number }) => { order.push(t.id); return 'completed' as const; });
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => clock, run });
    m.create({ title: 'A', prompt: 'a', schedule: { every: '1h' } });
    m.create({ title: 'B', prompt: 'b', schedule: { every: '2h' } });
    await m.tick();
    expect(run).not.toHaveBeenCalled();
    clock = new Date('2026-09-08T11:00:00.000Z');
    await m.tick();
    expect(order).toEqual([1]);
    expect(m.get(1)?.nextRunAt).toBe('2026-09-08T12:00:00.000Z');
    clock = new Date('2026-09-08T12:30:00.000Z');
    await m.tick();
    expect(order).toEqual([1, 1, 2]);
  });
});
