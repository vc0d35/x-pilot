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
    await m.idle();
    expect(run).not.toHaveBeenCalled();
    clock = new Date('2026-09-08T11:00:00.000Z');
    await m.tick();
    await m.idle();
    expect(order).toEqual([1]);
    expect(m.get(1)?.nextRunAt).toBe('2026-09-08T12:00:00.000Z');
    clock = new Date('2026-09-08T12:30:00.000Z');
    await m.tick();
    await m.idle();
    expect(order).toEqual([1, 1, 2]);
  });

  it('does not re-enqueue a task that is still due while its run is in flight', async () => {
    let clock = now;
    let release!: () => void;
    const started: number[] = [];
    const run = vi.fn(async (t: { id: number }) => {
      started.push(t.id);
      await new Promise<void>((r) => { release = r; });
      return 'completed' as const;
    });
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => clock, run });
    m.create({ title: 'A', prompt: 'a', schedule: { every: '5m' } });

    clock = new Date('2026-09-08T11:00:00.000Z');
    await m.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([1]);
    expect(m.get(1)?.nextRunAt).toBe('2026-09-08T11:05:00.000Z'); // rescheduled at enqueue, not at completion
    expect(m.get(1)?.lastStatus).toBe('running');

    clock = new Date('2026-09-08T11:10:00.000Z'); // due again, but the first run has not finished
    await m.tick();
    await m.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([1]);
    expect(m.get(1)?.nextRunAt).toBe('2026-09-08T11:05:00.000Z');

    release();
    await m.idle();
    expect(started).toEqual([1]);
    expect(m.get(1)?.lastStatus).toBe('completed');
  });

  it('tick returns before the runs finish, and idle waits for them', async () => {
    let clock = now;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const done: number[] = [];
    const run = vi.fn(async (t: { id: number }) => { await gate; done.push(t.id); return 'completed' as const; });
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => clock, run });
    m.create({ title: 'A', prompt: 'a', schedule: { every: '5m' } });
    m.create({ title: 'B', prompt: 'b', schedule: { every: '5m' } });

    clock = new Date('2026-09-08T11:00:00.000Z');
    await m.tick();
    expect(done).toEqual([]);
    const idle = m.idle();
    release();
    await idle;
    expect(done).toEqual([1, 2]);
  });

  it('idle resolves immediately when nothing is queued', async () => {
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => now });
    await expect(m.idle()).resolves.toBeUndefined();
  });

  it('runNow on a task that is already queued joins the queued run instead of adding another', async () => {
    const clock = new Date('2026-09-08T11:00:00.000Z');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = vi.fn(async () => { await gate; return 'completed' as const; });
    const m = new TaskManager({ store: new HistoryStore(':memory:'), now: () => clock, run });
    const t = m.create({ title: 'A', prompt: 'a', schedule: { every: '1h' } });
    const first = m.runNow(t.id);
    const second = m.runNow(t.id);
    release();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
