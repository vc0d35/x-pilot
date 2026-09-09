import { describe, it, expect } from 'vitest';
import { parseSchedule, nextRun, describeSchedule } from './schedule';

describe('parseSchedule', () => {
  it('accepts durations of at least 5 minutes', () => {
    expect(parseSchedule({ every: '1h' })).toEqual({ every: '1h' });
    expect(parseSchedule({ every: '30m' })).toEqual({ every: '30m' });
    expect(() => parseSchedule({ every: '2m' })).toThrow(/at least 5 minutes/);
    expect(() => parseSchedule({ every: 'soon' })).toThrow(/every/);
  });
  it('accepts valid cron and rejects garbage', () => {
    expect(parseSchedule({ cron: '0 * * * *' })).toEqual({ cron: '0 * * * *' });
    expect(() => parseSchedule({ cron: 'every hour' })).toThrow(/cron/);
    expect(() => parseSchedule({} as never)).toThrow(/schedule/);
  });
  it('holds cron to the same 5-minute floor as "every"', () => {
    expect(() => parseSchedule({ cron: '* * * * * *' })).toThrow(/every 5 minutes/);
    expect(() => parseSchedule({ cron: '*/10 * * * * *' })).toThrow(/every 5 minutes/);
    expect(() => parseSchedule({ cron: '* * * * *' })).toThrow(/every 5 minutes/);
    expect(parseSchedule({ cron: '*/5 * * * *' })).toEqual({ cron: '*/5 * * * *' });
    expect(parseSchedule({ cron: '0 9 * * 1-5' })).toEqual({ cron: '0 9 * * 1-5' });
  });
});

describe('nextRun', () => {
  const from = new Date('2026-09-08T10:07:00.000Z');
  it('adds the duration', () => {
    expect(nextRun({ every: '1h' }, from).toISOString()).toBe('2026-09-08T11:07:00.000Z');
    expect(nextRun({ every: '1d' }, from).toISOString()).toBe('2026-09-09T10:07:00.000Z');
  });
  it('follows cron in UTC-agnostic terms (next top of hour)', () => {
    expect(nextRun({ cron: '0 * * * *' }, from).getMinutes()).toBe(0);
    expect(nextRun({ cron: '0 * * * *' }, from).getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('describeSchedule', () => {
  it('is readable', () => {
    expect(describeSchedule({ every: '1h' })).toBe('every 1h');
    expect(describeSchedule({ cron: '0 9 * * 1-5' })).toBe('cron 0 9 * * 1-5');
  });
});
