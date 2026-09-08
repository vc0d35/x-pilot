import { Menu, app } from 'electron';

/** Standard macOS menus plus View → Toggle Sidebar (⌘\\), the way back from a fully collapsed sidebar. */
export function installAppMenu(deps: { toggleSidebar(): void }): void {
  const menu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CommandOrControl+\\', click: () => deps.toggleSidebar() },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
  app.setAboutPanelOptions({ applicationName: 'XPilot' });
}
