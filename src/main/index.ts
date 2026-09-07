import { app } from 'electron';
import { join } from 'node:path';
import { createMainWindow } from './window';

const START_URL = process.env.XPILOT_START_URL ?? 'https://x.com/home';

app.whenReady().then(() => {
  const { xView } = createMainWindow({
    preloadX: join(__dirname, '../preload/x.js'),
    preloadSidebar: join(__dirname, '../preload/sidebar.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(__dirname, '../renderer/index.html'),
  });
  void xView.webContents.loadURL(START_URL);
});

app.on('window-all-closed', () => app.quit());
