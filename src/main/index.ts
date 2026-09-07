import { app, shell } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './window';
import { attachNavigationPolicy, DEFAULT_ALLOW_HOSTS } from './navigation/policy';

const START_URL = process.env.XPILOT_START_URL ?? 'https://x.com/home';

app.whenReady().then(() => {
  const { xView } = createMainWindow({
    preloadX: join(__dirname, '../preload/x.js'),
    preloadSidebar: join(__dirname, '../preload/sidebar.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  });
  void xView.webContents.loadURL(START_URL);

  attachNavigationPolicy(xView.webContents, {
    allowHosts: () => DEFAULT_ALLOW_HOSTS, // replaced by settings in Task 4
    openExternal: (url) => void shell.openExternal(url),
  });

  xView.webContents.on('did-create-window', (child) => {
    attachNavigationPolicy(child.webContents, {
      allowHosts: () => [...DEFAULT_ALLOW_HOSTS, 'accounts.google.com', 'appleid.apple.com'],
      openExternal: (url) => void shell.openExternal(url),
    });
  });
});

app.on('window-all-closed', () => app.quit());
