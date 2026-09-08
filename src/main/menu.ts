import { Menu, app, type MenuItemConstructorOptions } from 'electron';

const RELEASES_URL = 'https://github.com/vc0d35/x-pilot/releases';
const ISSUES_URL = 'https://github.com/vc0d35/x-pilot/issues';

/** Standard macOS menus plus View → Toggle Sidebar (⌘\\), the way back from a fully collapsed sidebar. */
export function installAppMenu(deps: {
  toggleSidebar(): void;
  focusAgentInput(): void;
  openExternal(url: string): void;
}): void {
  const devItems: MenuItemConstructorOptions[] = app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }];
  const menu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CommandOrControl+\\', click: () => deps.toggleSidebar() },
        { label: 'Focus Agent Input', accelerator: 'Ctrl+D', click: () => deps.focusAgentInput() },
        ...devItems,
        { type: 'separator' }, { role: 'togglefullscreen' },
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
  app.setAboutPanelOptions({ applicationName: 'XPilot' });
}
