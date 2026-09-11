import { BaseWindow, WebContentsView, screen } from 'electron';
import {
  computeLayout,
  HANDLE_HEIGHT,
  HANDLE_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH_OPEN,
  minimumSize,
  widenedBounds,
  type HandlePosition,
} from './layout';
import { IPC } from '../shared/ipc';
import type { WindowBounds } from './window-state';

export interface MainWindowOptions {
  preloadX: string;
  preloadSidebar: string;
  /** The dev server in `npm run dev`, otherwise the built renderer on the app's own scheme. */
  sidebarUrl: string;
  bounds: WindowBounds;
  /** Where the user last dropped the collapsed handle; null puts it back in its default spot. */
  handle: HandlePosition | null;
  onBoundsChanged(bounds: WindowBounds): void;
}

export interface MainWindow {
  win: BaseWindow;
  xView: WebContentsView;
  sidebar: WebContentsView;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isSidebarCollapsed: () => boolean;
  /**
   * The user picked the collapsed handle up. The sidebar view — which is the handle — is stretched
   * over the whole window so the pointer can never leave it and its background is made transparent,
   * so only the pill the renderer draws at the pointer paints. Answers with where the handle was
   * and how big it is, for the renderer to draw it there until the first move; null if not collapsed.
   */
  beginHandleDrag: () => { x: number; y: number; width: number; height: number } | null;
  /** Puts the handle back at `position` (already clamped), or where it was when that is null. */
  endHandleDrag: (position: HandlePosition | null) => void;
  /**
   * Puts a view over the X page, or takes it back off. It goes between the X view and the sidebar,
   * so the collapsed sidebar's handle stays clickable over it, and it is laid out with the X view's
   * own bounds so the page underneath keeps rendering at the size it was.
   */
  setOverlayView: (view: WebContentsView | null) => void;
}

export function createMainWindow(opts: MainWindowOptions): MainWindow {
  const win = new BaseWindow({ ...opts.bounds, minWidth: MIN_WIDTH_OPEN, minHeight: MIN_HEIGHT, title: 'XPilot' });
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
  let handle: HandlePosition | null = opts.handle;
  let dragging = false;
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const l = computeLayout(width, height, collapsed, handle);
    xView.setBounds(l.xView);
    overlay?.setBounds(l.xView);
    // A window resized mid-drag keeps the handle's view over all of it; the drop re-clamps.
    sidebar.setBounds(dragging ? { x: 0, y: 0, width, height } : l.sidebar);
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
      if (!win.isDestroyed()) {
        const min = minimumSize(c);
        win.setMinimumSize(min.width, min.height);
        if (!c) {
          const bounds = win.getBounds();
          const widened = widenedBounds(bounds, min.width, screen.getDisplayMatching(bounds).workArea);
          if (widened !== bounds) win.setBounds(widened);
        }
      }
      // A sidebar that came back out mid-drag (⌘\\, or a card that needs answering) is not a pill
      // being carried any more; the drag's own end is ignored once the press it belonged to is gone.
      dragging = false;
      layout();
      if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send(IPC.sidebarCollapsed, c);
    },
    isSidebarCollapsed: () => collapsed,
    beginHandleDrag: () => {
      if (!collapsed || dragging || win.isDestroyed()) return null;
      const from = sidebar.getBounds();
      dragging = true;
      // Nothing restores this: the document paints its own background everywhere it is not the
      // pill, so a transparent view only shows through while the renderer makes its root transparent.
      sidebar.setBackgroundColor('#00000000');
      layout();
      return { x: from.x, y: from.y, width: HANDLE_WIDTH, height: HANDLE_HEIGHT };
    },
    endHandleDrag: (position) => {
      dragging = false;
      if (position) handle = position;
      layout();
    },
    // The canvas stays a child of the window once added and is only hidden: navigating a
    // WebContentsView that has just been removed from its window crashes Electron 44 (SIGSEGV
    // seen on CI right after a view was deactivated).
    setOverlayView: (view) => {
      if (win.isDestroyed()) return;
      if (view === null) {
        overlay?.setVisible(false);
        overlay = null;
        layout();
        return;
      }
      if (overlay !== view) {
        overlay?.setVisible(false);
        // Index 1: above the X page, below the sidebar and its floating handle.
        if (!win.contentView.children.includes(view)) win.contentView.addChildView(view, 1);
        overlay = view;
      }
      view.setVisible(true);
      layout();
    },
  };
}
