import { BaseWindow, WebContentsView } from 'electron';

export const SIDEBAR_WIDTH = 420;

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
}

export function createMainWindow(opts: MainWindowOptions): MainWindow {
  const win = new BaseWindow({ width: 1500, height: 950, minWidth: 1000, minHeight: 600, title: 'X Pilot' });

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

  const layout = () => {
    const { width, height } = win.getContentBounds();
    xView.setBounds({ x: 0, y: 0, width: Math.max(0, width - SIDEBAR_WIDTH), height });
    sidebar.setBounds({ x: Math.max(0, width - SIDEBAR_WIDTH), y: 0, width: SIDEBAR_WIDTH, height });
  };
  layout();
  win.on('resize', layout);

  if (opts.rendererUrl) void sidebar.webContents.loadURL(opts.rendererUrl);
  else if (opts.rendererFile) void sidebar.webContents.loadFile(opts.rendererFile);

  return { win, xView, sidebar };
}
