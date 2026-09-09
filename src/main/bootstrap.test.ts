import { describe, it, expect } from 'vitest';
import { resolveDevSwitches, toolsForScheduledRuns } from './bootstrap';
import { SIDEBAR_URL } from './hardening';

const env = {
  XPILOT_USER_DATA: '/tmp/profile',
  XPILOT_CDP_PORT: '9222',
  XPILOT_START_URL: 'file:///fixture.html',
  ELECTRON_RENDERER_URL: 'http://localhost:5173',
  XPILOT_E2E: '1',
};

describe('resolveDevSwitches', () => {
  it('honours every switch in a development run', () => {
    expect(resolveDevSwitches(env, true)).toEqual({
      userData: '/tmp/profile', cdpPort: '9222', startUrl: 'file:///fixture.html', sidebarUrl: 'http://localhost:5173', e2e: true,
    });
  });

  it('ignores all of them in a packaged run, however the environment was set', () => {
    expect(resolveDevSwitches(env, false)).toEqual({
      userData: null, cdpPort: null, startUrl: 'https://x.com/home', sidebarUrl: SIDEBAR_URL, e2e: false,
    });
  });

  it('falls back to the real start and sidebar URLs when nothing is set', () => {
    expect(resolveDevSwitches({}, true)).toEqual({
      userData: null, cdpPort: null, startUrl: 'https://x.com/home', sidebarUrl: SIDEBAR_URL, e2e: false,
    });
  });

  it('treats an empty value as unset, and only XPILOT_E2E=1 as e2e', () => {
    expect(resolveDevSwitches({ XPILOT_USER_DATA: '', XPILOT_START_URL: '' }, true)).toMatchObject({ userData: null, startUrl: 'https://x.com/home' });
    expect(resolveDevSwitches({ XPILOT_E2E: 'true' }, true).e2e).toBe(false);
  });
});

describe('toolsForScheduledRuns', () => {
  const tool = (name: string) => ({ spec: { name } });

  it('drops the task-management tools so a run cannot reschedule itself or its peers', () => {
    const tools = [tool('xpilot_search_history'), tool('xpilot_schedule_task'), tool('xpilot_update_task'), tool('xpilot_delete_task'), tool('xpilot_list_library')];
    expect(toolsForScheduledRuns(tools).map((t) => t.spec.name)).toEqual(['xpilot_search_history', 'xpilot_list_library']);
  });

  it('leaves a list without them untouched', () => {
    const tools = [tool('xpilot_search_history')];
    expect(toolsForScheduledRuns(tools)).toEqual(tools);
  });
});
