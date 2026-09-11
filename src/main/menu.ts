import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import type { ViewListEntry } from '../shared/views';

const RELEASES_URL = 'https://github.com/vc0d35/x-pilot/releases';
const ISSUES_URL = 'https://github.com/vc0d35/x-pilot/issues';

export interface AppMenuDeps {
  toggleSidebar(): void;
  focusAgentInput(): void;
  openExternal(url: string): void;
  /** The custom views, as the menu offers them; the list is read afresh on every rebuild. */
  views: {
    list(): ViewListEntry[];
    activate(name: string): void;
    deactivate(): void;
  };
}

export interface InstalledAppMenu {
  /** Rebuilds the whole menu from the current list. A menu is cheap; a stale one is a wrong one. */
  refresh(): void;
}

/**
 * The custom-view items of the View menu: the way back to X, then one item per view with the one on
 * screen checked. A view with no index.html cannot be loaded, so it is offered greyed out rather
 * than left out — the user wrote it and should see why it is not available.
 */
export function buildViewsMenuItems(
  views: ViewListEntry[],
  actions: { activate(name: string): void; deactivate(): void },
): MenuItemConstructorOptions[] {
  return [
    { type: 'separator' },
    {
      label: 'Back to X',
      accelerator: 'CommandOrControl+Shift+X',
      enabled: views.some((v) => v.active),
      click: () => actions.deactivate(),
    },
    ...views.map((view): MenuItemConstructorOptions => ({
      label: `Activate ${view.name}`,
      type: 'checkbox',
      checked: view.active,
      enabled: view.hasIndex,
      click: () => actions.activate(view.name),
    })),
  ];
}

/**
 * Standard macOS menus plus View → Toggle Sidebar (⌘\\), the way back from a fully collapsed
 * sidebar, and the custom views: showing one is something the user can do themselves, without
 * asking the agent for it.
 */
export function installAppMenu(deps: AppMenuDeps): InstalledAppMenu {
  const build = (): void => {
    const devItems: MenuItemConstructorOptions[] = app.isPackaged
      ? []
      : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }];
    const menu = Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Sidebar', accelerator: 'CommandOrControl+\\', click: () => deps.toggleSidebar() },
          { label: 'Focus Agent Input', accelerator: 'Ctrl+D', click: () => deps.focusAgentInput() },
          ...buildViewsMenuItems(deps.views.list(), deps.views),
          ...devItems,
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'Check for Updates…', click: () => deps.openExternal(RELEASES_URL) },
          { label: 'Report an Issue…', click: () => deps.openExternal(ISSUES_URL) },
        ],
      },
    ]);
    Menu.setApplicationMenu(menu);
  };
  build();
  app.setAboutPanelOptions({ applicationName: 'XPilot' });
  return { refresh: build };
}
