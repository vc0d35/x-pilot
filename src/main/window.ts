import { BaseWindow, WebContentsView } from 'electron';
import { computeLayout } from './layout';
import { IPC } from '../shared/ipc';
import type { WindowBounds } from './window-state';

export interface MainWindowOptions {
  preloadX: string;
  preloadSidebar: string;
  rendererUrl?: string;   // dev server
  rendererFile?: string;  // built index.html
  bounds: WindowBounds;
  onBoundsChanged(bounds: WindowBounds): void;
}

export interface MainWindow {
  win: BaseWindow;
  xView: WebContentsView;
  sidebar: WebContentsView;
  setSidebarCollapsed(collapsed: boolean): void;
  isSidebarCollapsed(): boolean;
}

export function createMainWindow(opts: MainWindowOptions): MainWindow {
  const win = new BaseWindow({ ...opts.bounds, minWidth: 1000, minHeight: 600, title: 'XPilot' });
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!win.isDestroyed()) opts.onBoundsChanged(win.getBounds()); }, 400);
  };
  win.on('move', scheduleSave);

  const xView = new WebContentsView({
    webPreferences: {
      partition: 'persist:x',
      preload: opts.preloadX,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const sidebar = new WebContentsView({
    webPreferences: {
      preload: opts.preloadSidebar,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.contentView.addChildView(xView);
  win.contentView.addChildView(sidebar);

  let collapsed = false;
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const l = computeLayout(width, height, collapsed);
    xView.setBounds(l.xView);
    sidebar.setBounds(l.sidebar);
  };
  layout();
  win.on('resize', () => { layout(); scheduleSave(); });

  if (opts.rendererUrl) void sidebar.webContents.loadURL(opts.rendererUrl);
  else if (opts.rendererFile) void sidebar.webContents.loadFile(opts.rendererFile);

  return { win, xView, sidebar, setSidebarCollapsed: (c) => { collapsed = c; layout(); if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send(IPC.sidebarCollapsed, c); }, isSidebarCollapsed: () => collapsed };
}
