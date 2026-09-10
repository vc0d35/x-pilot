import { describe, it, expect } from 'vitest';
import {
  VIEW_CONSOLE_TEXT_MAX,
  VIEW_FATAL_ERROR_WINDOW_MS,
  VIEW_RUNTIME_ERRORS_PER_WINDOW,
  VIEW_RUNTIME_ERROR_WINDOW_MS,
  VIEW_RUNTIME_REPORT_MS,
  type ViewLogEntry,
} from '../../shared/views';
import { ViewErrorCounters, boundConsoleEntries, formatWhere } from './errors';

const clock = () => {
  let at = 1_000_000;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

describe('ViewErrorCounters: runtime errors', () => {
  it('reports the first error of an activation, then at most one every 30 s', () => {
    const c = clock();
    const counters = new ViewErrorCounters(c.now);
    counters.activated('feed');
    expect(counters.runtime('feed')).toEqual({ report: true, storm: false });
    expect(counters.runtime('feed')).toEqual({ report: false, storm: false });
    c.advance(VIEW_RUNTIME_REPORT_MS - 1);
    expect(counters.runtime('feed').report).toBe(false);
    c.advance(1);
    expect(counters.runtime('feed').report).toBe(true);
  });

  it('reports again after the view is activated afresh: the agent may have just fixed it', () => {
    const c = clock();
    const counters = new ViewErrorCounters(c.now);
    counters.activated('feed');
    expect(counters.runtime('feed').report).toBe(true);
    expect(counters.runtime('feed').report).toBe(false);
    counters.activated('feed');
    expect(counters.runtime('feed').report).toBe(true);
  });

  it('calls a storm past twenty errors in a minute, and forgets them as the window slides', () => {
    const c = clock();
    const counters = new ViewErrorCounters(c.now);
    counters.activated('feed');
    for (let i = 0; i < VIEW_RUNTIME_ERRORS_PER_WINDOW; i++) expect(counters.runtime('feed').storm, `error ${i}`).toBe(false);
    expect(counters.runtime('feed').storm).toBe(true);

    const slow = new ViewErrorCounters(c.now);
    slow.activated('feed');
    for (let i = 0; i < VIEW_RUNTIME_ERRORS_PER_WINDOW; i++) slow.runtime('feed');
    c.advance(VIEW_RUNTIME_ERROR_WINDOW_MS);
    expect(slow.runtime('feed').storm).toBe(false);
  });

  it('counts each view on its own', () => {
    const counters = new ViewErrorCounters(clock().now);
    counters.activated('feed');
    counters.activated('cards');
    for (let i = 0; i <= VIEW_RUNTIME_ERRORS_PER_WINDOW; i++) counters.runtime('feed');
    expect(counters.runtime('cards').storm).toBe(false);
  });
});

describe('ViewErrorCounters: crashes and wedges', () => {
  it('is a storm at the second one inside five minutes, however often the view is reactivated', () => {
    const c = clock();
    const counters = new ViewErrorCounters(c.now);
    counters.activated('feed');
    expect(counters.fatal('feed')).toBe(false);
    // A crash is not forgotten by putting the view back on screen: that is how a retry loop starts.
    counters.activated('feed');
    expect(counters.fatal('feed')).toBe(true);
  });

  it('forgets a crash once the five minutes are up', () => {
    const c = clock();
    const counters = new ViewErrorCounters(c.now);
    expect(counters.fatal('feed')).toBe(false);
    c.advance(VIEW_FATAL_ERROR_WINDOW_MS);
    expect(counters.fatal('feed')).toBe(false);
  });
});

describe('ViewErrorCounters: reloading a view that will not load', () => {
  it('stops after two failures in a row, and lets the next file change try again', () => {
    const counters = new ViewErrorCounters(clock().now);
    counters.activated('feed');
    expect(counters.shouldReload('feed')).toBe(true);
    counters.reloadFailed('feed');
    expect(counters.shouldReload('feed')).toBe(true);
    counters.reloadFailed('feed');
    expect(counters.shouldReload('feed')).toBe(false);
    expect(counters.shouldReload('feed')).toBe(true);
  });

  it('forgets the failures as soon as one load finishes', () => {
    const counters = new ViewErrorCounters(clock().now);
    counters.reloadFailed('feed');
    counters.reloadFailed('feed');
    counters.loaded('feed');
    expect(counters.shouldReload('feed')).toBe(true);
  });
});

describe('formatWhere', () => {
  it('says as much of file:line:col as the view knew', () => {
    expect(formatWhere({ source: 'xpilot://views/feed/app.js', line: 12, column: 5 })).toBe('xpilot://views/feed/app.js:12:5');
    expect(formatWhere({ source: 'app.js', line: 12 })).toBe('app.js:12');
    expect(formatWhere({ source: 'app.js' })).toBe('app.js');
    expect(formatWhere({ line: 12, column: 5 })).toBeUndefined();
  });
});

const entry = (text: string, where?: string): ViewLogEntry => ({
  at: '2026-01-01T00:00:00.000Z',
  source: 'error',
  level: 'error',
  text,
  ...(where ? { where } : {}),
});

describe('boundConsoleEntries', () => {
  it('cuts every line at 500 characters and says it did', () => {
    const bounded = boundConsoleEntries([entry('x'.repeat(VIEW_CONSOLE_TEXT_MAX + 100))]);
    expect(bounded.entries[0].text).toHaveLength(VIEW_CONSOLE_TEXT_MAX + 1);
    expect(bounded.truncated).toBe(true);
  });

  it('keeps the newest entries inside the byte cap and drops the oldest', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry(`line ${i}`.padEnd(400, '.')));
    const bounded = boundConsoleEntries(many);
    expect(Buffer.byteLength(JSON.stringify(bounded.entries))).toBeLessThanOrEqual(20 * 1024);
    expect(bounded.entries.length).toBeLessThan(many.length);
    expect(bounded.entries.at(-1)!.text).toContain('line 199');
    expect(bounded.truncated).toBe(true);
  });

  it('leaves a small log alone, in order, with where it happened', () => {
    const bounded = boundConsoleEntries([entry('one'), entry('two', 'app.js:3:1')]);
    expect(bounded).toEqual({ entries: [entry('one'), entry('two', 'app.js:3:1')], truncated: false });
  });
});
