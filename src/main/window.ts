import { BaseWindow, WebContentsView } from 'electron';
import { computeLayout } from './layout';
import { IPC } from '../shared/ipc';
import type { WindowBounds } from './window-state';

export interface MainWindowOptions {
  preloadX: string;
  preloadSidebar: string;
  /** The dev server in `npm run dev`, otherwise the built renderer on the app's own scheme. */
  sidebarUrl: string;
  bounds: WindowBounds;
  onBoundsChanged(bounds: WindowBounds): void;
}

export interface MainWindow {
  win: BaseWindow;
  xView: WebContentsView;
  sidebar: WebContentsView;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isSidebarCollapsed: () => boolean;
  /**
   * Puts a view over the X page, or takes it back off. It goes between the X view and the sidebar,
   * so the collapsed sidebar's handle stays clickable over it, and it is laid out with the X view's
   * own bounds so the page underneath keeps rendering at the size it was.
   */
  setOverlayView: (view: WebContentsView | null) => void;
}

export function createMainWindow(opts: MainWindowOptions): MainWindow {
  const win = new BaseWindow({ ...opts.bounds, minWidth: 1000, minHeight: 600, title: 'XPilot' });
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed()) opts.onBoundsChanged(win.getBounds());
    }, 400);
  };
  win.on('move', scheduleSave);

  const xView = new WebContentsView({
    webPreferences: {
      partition: 'persist:x',
      preload: opts.preloadX,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
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
  let overlay: WebContentsView | null = null;
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const l = computeLayout(width, height, collapsed);
    xView.setBounds(l.xView);
    overlay?.setBounds(l.xView);
    sidebar.setBounds(l.sidebar);
  };
  layout();
  win.on('resize', () => {
    layout();
    scheduleSave();
  });

  void sidebar.webContents.loadURL(opts.sidebarUrl);

  return {
    win,
    xView,
    sidebar,
    setSidebarCollapsed: (c) => {
      collapsed = c;
      layout();
      if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send(IPC.sidebarCollapsed, c);
    },
    isSidebarCollapsed: () => collapsed,
    setOverlayView: (view) => {
      if (overlay === view) return;
      if (overlay) win.contentView.removeChildView(overlay);
      overlay = view;
      // Index 1: above the X page, below the sidebar and its floating handle.
      if (view) win.contentView.addChildView(view, 1);
      layout();
    },
  };
}
