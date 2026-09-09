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
});
