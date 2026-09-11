import { describe, it, expect, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import type { ViewListEntry } from '../shared/views';

/** Electron's Menu with nothing under it: what is built is the whole behaviour worth checking. */
const built = (): MenuItemConstructorOptions[] => (globalThis as { __menu?: MenuItemConstructorOptions[] }).__menu ?? [];

vi.mock('electron', () => ({
  app: { isPackaged: true, setAboutPanelOptions: () => {} },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      (globalThis as { __menu?: MenuItemConstructorOptions[] }).__menu = template;
      return { template };
    },
    setApplicationMenu: () => {},
  },
}));

const { buildViewsMenuItems, installAppMenu } = await import('./menu');

const view = (name: string, over: Partial<ViewListEntry> = {}): ViewListEntry => ({
  name,
  files: 2,
  hasIndex: true,
  active: false,
  ...over,
});

const label = (item: MenuItemConstructorOptions): string => (typeof item.label === 'string' ? item.label : '');

describe('buildViewsMenuItems', () => {
  it('offers one item per view, with the one on screen checked', () => {
    const items = buildViewsMenuItems([view('cards', { active: true }), view('reader')], { activate: () => {}, deactivate: () => {} });
    expect(items.map(label)).toEqual(['', 'Back to X', 'Activate cards', 'Activate reader']);
    expect(items[0].type).toBe('separator');
    expect(items.slice(2).map((i) => i.checked)).toEqual([true, false]);
  });

  it('greys out Back to X while the user is on the X page, and enables it while a view is up', () => {
    const actions = { activate: () => {}, deactivate: () => {} };
    expect(buildViewsMenuItems([view('cards')], actions)[1].enabled).toBe(false);
    expect(buildViewsMenuItems([view('cards', { active: true })], actions)[1].enabled).toBe(true);
    expect(buildViewsMenuItems([view('cards')], actions)[1].accelerator).toBe('CommandOrControl+Shift+X');
  });

  it('greys out a view with no index.html rather than leaving it out', () => {
    const items = buildViewsMenuItems([view('half', { hasIndex: false })], { activate: () => {}, deactivate: () => {} });
    expect(items[2]).toMatchObject({ label: 'Activate half', enabled: false });
  });

  it('activates the view its own item names, and deactivates from Back to X', () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const items = buildViewsMenuItems([view('cards'), view('reader')], { activate, deactivate });
    items[3].click?.(undefined as never, undefined, undefined as never);
    items[1].click?.(undefined as never, undefined, undefined as never);
    expect(activate).toHaveBeenCalledWith('reader');
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
});

describe('installAppMenu', () => {
  const viewSubmenu = (): MenuItemConstructorOptions[] =>
    (built().find((m) => m.label === 'View')?.submenu as MenuItemConstructorOptions[]) ?? [];

  it('puts the views under the View menu, after the two items that were already there', () => {
    installAppMenu({
      toggleSidebar: () => {},
      focusAgentInput: () => {},
      openExternal: () => {},
      views: { list: () => [view('cards', { active: true })], activate: () => {}, deactivate: () => {} },
    });
    expect(viewSubmenu().map(label)).toEqual(['Toggle Sidebar', 'Focus Agent Input', '', 'Back to X', 'Activate cards', '', '']);
  });

  it('rebuilds from the current list when it is refreshed', () => {
    let views = [view('cards')];
    const menu = installAppMenu({
      toggleSidebar: () => {},
      focusAgentInput: () => {},
      openExternal: () => {},
      views: { list: () => views, activate: () => {}, deactivate: () => {} },
    });
    expect(viewSubmenu().map(label)).toContain('Activate cards');
    views = [view('reader', { active: true })];
    menu.refresh();
    expect(viewSubmenu().map(label)).not.toContain('Activate cards');
    expect(viewSubmenu().find((i) => label(i) === 'Back to X')?.enabled).toBe(true);
  });
});
