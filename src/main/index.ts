import { app, shell } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './window';
import { attachNavigationPolicy } from './navigation/policy';
import { SettingsStore } from './settings';

const START_URL = process.env.XPILOT_START_URL ?? 'https://x.com/home';

app.whenReady().then(() => {
  const { xView } = createMainWindow({
    preloadX: join(__dirname, '../preload/x.js'),
    preloadSidebar: join(__dirname, '../preload/sidebar.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  });
  void xView.webContents.loadURL(START_URL);

  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));

  attachNavigationPolicy(xView.webContents, {
    allowHosts: () => settings.get().navigation.allowHosts,
    openExternal: (url) => void shell.openExternal(url),
  });

  xView.webContents.on('did-create-window', (child) => {
    attachNavigationPolicy(child.webContents, {
      allowHosts: () => [...settings.get().navigation.allowHosts, 'accounts.google.com', 'appleid.apple.com'],
      openExternal: (url) => void shell.openExternal(url),
    });
  });
});

app.on('window-all-closed', () => app.quit());
