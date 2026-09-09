import { describe, it, expect } from 'vitest';
import { activityLabel } from './EntryList';

describe('activityLabel', () => {
  it('names each activity, and says so while a wedged turn is being waited on', () => {
    expect(activityLabel({ activity: 'thinking' })).toBe('thinking');
    expect(activityLabel({ activity: 'writing' })).toBe('writing');
    expect(activityLabel({ activity: 'waiting' })).toBe('still waiting for Codex');
    expect(activityLabel({ activity: 'tool', detail: 'web_search' })).toBe('searching the web');
    expect(activityLabel({ activity: 'tool', detail: 'x_unknown' })).toBe('running x_unknown');
  });
});
