import { describe, it, expect } from 'vitest';
import { createTaskRegistryFactory, resolveDevSwitches, toolsForScheduledRuns } from './bootstrap';
import { SIDEBAR_URL } from './hardening';
import { appTools } from './tools/app';
import { adapterToolSpecs } from '../preload/x/adapter/tools/specs';
import { ok } from '../shared/tools';
import type { ToolSource } from './tools/registry';
import type { AppToolCtx } from './tools/app/context';
import type { ApprovalBroker } from './approvals';
import type { XViewLike } from './tools/xview/context';

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
      userData: '/tmp/profile',
      cdpPort: '9222',
      startUrl: 'file:///fixture.html',
      sidebarUrl: 'http://localhost:5173',
      e2e: true,
    });
  });

  it('ignores all of them in a packaged run, however the environment was set', () => {
    expect(resolveDevSwitches(env, false)).toEqual({
      userData: null,
      cdpPort: null,
      startUrl: 'https://x.com/home',
      sidebarUrl: SIDEBAR_URL,
      e2e: false,
    });
  });

  it('falls back to the real start and sidebar URLs when nothing is set', () => {
    expect(resolveDevSwitches({}, true)).toEqual({
      userData: null,
      cdpPort: null,
      startUrl: 'https://x.com/home',
      sidebarUrl: SIDEBAR_URL,
      e2e: false,
    });
  });

  it('treats an empty value as unset, and only XPILOT_E2E=1 as e2e', () => {
    expect(resolveDevSwitches({ XPILOT_USER_DATA: '', XPILOT_START_URL: '' }, true)).toMatchObject({
      userData: null,
      startUrl: 'https://x.com/home',
    });
    expect(resolveDevSwitches({ XPILOT_E2E: 'true' }, true).e2e).toBe(false);
  });
});

describe('toolsForScheduledRuns', () => {
  const tool = (name: string) => ({ spec: { name } });

  it('drops the task-management tools so a run cannot reschedule itself or its peers', () => {
    const tools = [
      tool('xpilot_search_history'),
      tool('xpilot_schedule_task'),
      tool('xpilot_update_task'),
      tool('xpilot_delete_task'),
      tool('xpilot_list_library'),
    ];
    expect(toolsForScheduledRuns(tools).map((t) => t.spec.name)).toEqual(['xpilot_search_history', 'xpilot_list_library']);
  });

  it('drops the page-config writers, so an unattended run cannot restyle the page or move a selector', () => {
    const names = toolsForScheduledRuns(appTools).map((t) => t.spec.name);
    for (const name of [
      'xpilot_write_page_styles',
      'xpilot_reset_page_styles',
      'xpilot_set_selector',
      'xpilot_reset_selector',
      'xpilot_test_selector',
    ])
      expect(names, name).not.toContain(name);
  });

  it('keeps the read tools, so a run can still report that the adapter looks broken', () => {
    const names = toolsForScheduledRuns(appTools).map((t) => t.spec.name);
    expect(names).toContain('xpilot_read_page_styles');
    expect(names).toContain('xpilot_list_selectors');
  });

  it('drops the tools that write or show a custom view, and keeps the ones that only read them', () => {
    const names = toolsForScheduledRuns(appTools).map((t) => t.spec.name);
    for (const name of [
      'xpilot_write_view_file',
      'xpilot_delete_view',
      'xpilot_activate_view',
      'xpilot_deactivate_view',
      'xpilot_view_inspect',
    ])
      expect(names, name).not.toContain(name);
    for (const name of ['xpilot_list_views', 'xpilot_read_view_file', 'xpilot_view_console', 'xpilot_view_api'])
      expect(names, name).toContain(name);
  });

  it('leaves a list without them untouched', () => {
    const tools = [tool('xpilot_search_history')];
    expect(toolsForScheduledRuns(tools)).toEqual(tools);
  });
});

/** The tools only the visible view's preload can answer. */
const SCREEN_TOOLS = ['x_get_page_state', 'x_read_visible_posts', 'x_scroll', 'x_show_new_posts', 'x_read_current_post', 'x_inspect_page'];

describe('the tool set of one scheduled run', () => {
  const bridge: ToolSource = { id: 'adapter', list: () => adapterToolSpecs, call: async () => ok({ from: 'the preload' }) };
  const visibleView: XViewLike = {
    currentUrl: () => 'https://x.com/home',
    navigate: async () => {},
    callPreload: async () => ok({ from: "the user's window" }),
  };
  const factory = () =>
    createTaskRegistryFactory({
      xview: visibleView,
      bridge,
      background: async () => visibleView,
      allowHosts: () => ['x.com'],
      approvals: {} as ApprovalBroker,
      postingMode: () => 'confirm',
      likesMode: () => 'confirm',
      bookmarksMode: () => 'confirm',
      likes: { recordLike: () => {}, recordUnlike: () => {} },
      appCtx: {} as Omit<AppToolCtx, 'testSelector'>,
    });
  const hidden = () => factory()({ visibleWindow: false });
  const visible = () => factory()({ visibleWindow: true });

  it('gives a hidden run no screen tools and a visible view that refuses', async () => {
    const registry = hidden();
    const names = registry.list().map((t) => t.name);
    expect(names).toContain('x_read_post');
    for (const name of SCREEN_TOOLS) expect(names, name).not.toContain(name);
    expect(await registry.call('x_navigate', { url: 'https://x.com/home' })).toMatchObject({
      success: false,
      error: expect.stringContaining("cannot move the user's window"),
    });
  });

  it('gives a visible run the screen tools and the real window', async () => {
    const registry = visible();
    const names = registry.list().map((t) => t.name);
    for (const name of SCREEN_TOOLS) expect(names, name).toContain(name);
    expect(await registry.call('x_get_page_state', {})).toEqual(ok({ from: 'the preload' }));
    expect(await registry.call('x_navigate', { url: 'https://x.com/home' })).toEqual(ok({ from: "the user's window" }));
  });

  it('keeps every other rule of a scheduled run, whichever window it drives', () => {
    for (const registry of [hidden(), visible()]) {
      const names = registry.list().map((t) => t.name);
      for (const name of [
        'xpilot_schedule_task',
        'xpilot_update_task',
        'xpilot_delete_task',
        'xpilot_write_page_styles',
        'xpilot_set_selector',
      ])
        expect(names, name).not.toContain(name);
      expect(names).toContain('xpilot_search_history');
      expect(names).toContain('x_like_post');
    }
  });

  it('reuses one registry per kind, so a draft written in a run survives to the tool that posts it', () => {
    const registryFor = factory();
    expect(registryFor({ visibleWindow: false })).toBe(registryFor({ visibleWindow: false }));
    expect(registryFor({ visibleWindow: true })).toBe(registryFor({ visibleWindow: true }));
    expect(registryFor({ visibleWindow: true })).not.toBe(registryFor({ visibleWindow: false }));
  });
});
