import { describe, it, expect } from 'vitest';
import { HistoryDb } from './db';
import { TasksStore } from './tasks';

describe('TasksStore', () => {
  it('creates, lists, updates and deletes tasks', () => {
    const s = new TasksStore(new HistoryDb(':memory:').db);
    const t = s.create({
      title: 'Weather',
      prompt: 'Post the weather',
      schedule: { every: '1h' },
      threadMode: 'resume',
      nextRunAt: '2026-09-08T10:00:00.000Z',
    });
    expect(t.id).toBe(1);
    expect(s.list()[0]).toMatchObject({
      title: 'Weather',
      enabled: true,
      schedule: { every: '1h' },
      threadMode: 'resume',
      threadId: null,
      lastRunAt: null,
      webSearch: false,
    });
    s.update(1, {
      enabled: false,
      threadId: 'th-1',
      lastRunAt: '2026-09-08T10:00:05.000Z',
      lastStatus: 'completed',
      nextRunAt: '2026-09-08T11:00:00.000Z',
    });
    expect(s.get(1)).toMatchObject({ enabled: false, threadId: 'th-1', lastStatus: 'completed', nextRunAt: '2026-09-08T11:00:00.000Z' });
    expect(s.due('2026-09-08T11:00:00.000Z')).toEqual([]); // disabled
    s.update(1, { enabled: true });
    expect(s.due('2026-09-08T11:00:00.000Z').map((x) => x.id)).toEqual([1]);
    expect(s.due('2026-09-08T10:59:59.000Z')).toEqual([]);
    s.delete(1);
    expect(s.list()).toEqual([]);
  });

  it('starts a task with no watermark and only ever moves it forward', () => {
    const s = new TasksStore(new HistoryDb(':memory:').db);
    s.create({ title: 'Following', prompt: 'Like technical posts', schedule: { every: '1h' }, threadMode: 'resume', nextRunAt: null });
    expect(s.get(1)?.lastSeenPostId).toBeNull();
    s.advanceLastSeenPostId(1, '1900000000000000005');
    expect(s.get(1)?.lastSeenPostId).toBe('1900000000000000005');
    s.advanceLastSeenPostId(1, '1900000000000000001'); // an older read must not lose what earlier runs saw
    expect(s.get(1)?.lastSeenPostId).toBe('1900000000000000005');
    s.advanceLastSeenPostId(1, '9007199254740993'); // shorter, but compared as a number it is smaller
    expect(s.get(1)?.lastSeenPostId).toBe('1900000000000000005');
    s.advanceLastSeenPostId(1, '1900000000000000009');
    expect(s.get(1)?.lastSeenPostId).toBe('1900000000000000009');
  });

  it('ignores a watermark for a task that is gone', () => {
    const s = new TasksStore(new HistoryDb(':memory:').db);
    expect(() => s.advanceLastSeenPostId(404, '1900000000000000005')).not.toThrow();
    expect(s.list()).toEqual([]);
  });
});
