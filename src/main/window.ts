import { BaseWindow, WebContentsView } from 'electron';
import { computeLayout } from './layout';

export interface MainWindowOptions {
  preloadX: string;
  preloadSidebar: string;
  rendererUrl?: string;   // dev server
  rendererFile?: string;  // built index.html
}

export interface MainWindow {
  win: BaseWindow;
  xView: WebContentsView;
  sidebar: WebContentsView;
  setSidebarCollapsed(collapsed: boolean): void;
  isSidebarCollapsed(): boolean;
}

export function createMainWindow(opts: MainWindowOptions): MainWindow {
  const win = new BaseWindow({ width: 1500, height: 950, minWidth: 1000, minHeight: 600, title: 'XPilot' });

  const xView = new WebContentsView({
    webPreferences: {
      partition: 'persist:x',
      preload: opts.preloadX,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
    sidebar.setVisible(!collapsed);
  };
  layout();
  win.on('resize', layout);

  if (opts.rendererUrl) void sidebar.webContents.loadURL(opts.rendererUrl);
  else if (opts.rendererFile) void sidebar.webContents.loadFile(opts.rendererFile);

  return { win, xView, sidebar, setSidebarCollapsed: (c) => { collapsed = c; layout(); }, isSidebarCollapsed: () => collapsed };
}
