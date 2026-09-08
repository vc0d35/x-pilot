import { Menu, app, type MenuItemConstructorOptions } from 'electron';

/** Standard macOS menus plus View → Toggle Sidebar (⌘\\), the way back from a fully collapsed sidebar. */
export function installAppMenu(deps: { toggleSidebar(): void; focusAgentInput(): void }): void {
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
  ]);
  Menu.setApplicationMenu(menu);
  app.setAboutPanelOptions({ applicationName: 'XPilot' });
}
