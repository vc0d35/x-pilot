import { WebContentsView, type WebContents } from 'electron';
import { VIEW_LOG_LIMIT, VIEW_LOG_TEXT_MAX, type ViewLogEntry } from '../../shared/views';
import { viewOrigin, viewUrl } from './serve';
import type { Bounds } from '../layout';

const RELOAD_DEBOUNCE_MS = 300;

/** The last few lines each view produced, oldest dropped: a view is debugged from here, not a console. */
export class ViewLogs {
  private readonly byView = new Map<string, ViewLogEntry[]>();

  add(view: string, entry: Omit<ViewLogEntry, 'at'> & { at?: string }): void {
    const entries = this.byView.get(view) ?? [];
    entries.push({ at: entry.at ?? new Date().toISOString(), source: entry.source, level: entry.level, text: cut(entry.text) });
    if (entries.length > VIEW_LOG_LIMIT) entries.splice(0, entries.length - VIEW_LOG_LIMIT);
    this.byView.set(view, entries);
  }

  /** The newest `limit` entries of one view, or of every view when no view is named. */
  get(view?: string, limit: number = VIEW_LOG_LIMIT): ViewLogEntry[] {
    const entries =
      view === undefined ? [...this.byView.values()].flat().sort((a, b) => (a.at < b.at ? -1 : 1)) : (this.byView.get(view) ?? []);
    return entries.slice(-limit);
  }

  views(): string[] {
    return [...this.byView.keys()];
  }

  clear(view: string): void {
    this.byView.delete(view);
  }
}

const cut = (text: string): string => (text.length > VIEW_LOG_TEXT_MAX ? `${text.slice(0, VIEW_LOG_TEXT_MAX)}…` : text);

/** The navigation events a canvas can raise, as this module needs them; unit tests feed a fake. */
export interface CanvasNavigationContents {
  on(event: 'will-navigate' | 'will-redirect' | 'will-frame-navigate', listener: (details: NavigationLike) => void): unknown;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
}
export interface NavigationLike {
  url: string;
  isMainFrame?: boolean;
  preventDefault(): void;
}

/**
 * A canvas may only ever be inside the view it is showing. Everything else is cancelled outright —
 * not routed to the browser as a page link would be, because agent-written code asking for a URL is
 * not a user clicking one, and the canvas has no network of its own to make such a request useful.
 */
export function attachCanvasNavigationPolicy(contents: CanvasNavigationContents, allowedPrefix: () => string | null): void {
  const guard = (details: NavigationLike) => {
    const prefix = allowedPrefix();
    if (prefix && details.url.startsWith(prefix)) return;
    details.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame === false) guard(details);
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export interface ViewCanvasDeps {
  preload: string;
  partition: string;
  /** Puts the canvas over the X view, keeping the sidebar above it; and takes it back off. */
  mount(view: WebContentsView): void;
  unmount(view: WebContentsView): void;
  /** Where the canvas sits: the X view's bounds, so the page underneath keeps rendering at its size. */
  bounds(): Bounds;
  /** A view that could not be loaded, or whose renderer died: the app falls back to X and says so. */
  onFailure(view: string, message: string): void;
  /** Which view is on screen now, for the sidebar banner. */
  onActive(view: string | null): void;
}

/**
 * The third view: a sandboxed, network-less renderer on its own session that shows one custom view
 * over the X page. It is created the first time a view is shown and kept afterwards, because
 * showing and hiding a view is something the user does repeatedly while the agent is building one.
 */
export class ViewCanvas {
  private view: WebContentsView | null = null;
  private activeView: string | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  readonly logs = new ViewLogs();

  constructor(private readonly deps: ViewCanvasDeps) {}

  active(): string | null {
    return this.activeView;
  }

  contents(): WebContents | null {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  /** The WebContentsView itself, for the layout and the e2e harness. */
  webContentsView(): WebContentsView | null {
    return this.view;
  }

  /** Shows a view; resolves with why it could not be shown, or null once it is on screen. */
  async show(name: string): Promise<string | null> {
    const view = this.ensure();
    const was = this.activeView;
    this.activeView = name;
    if (!was) this.deps.mount(view);
    view.setBounds(this.deps.bounds());
    try {
      await view.webContents.loadURL(viewUrl(name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logs.add(name, { source: 'crash', level: 'error', text: `load failed: ${message}` });
      this.hide();
      this.deps.onFailure(name, message);
      return message;
    }
    this.deps.onActive(name);
    return null;
  }

  hide(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    const wasActive = this.activeView !== null;
    this.activeView = null;
    if (this.view) {
      this.deps.unmount(this.view);
      // Nothing of the view keeps running behind the X page: the canvas is left on a blank page.
      if (!this.view.webContents.isDestroyed()) void this.view.webContents.loadURL('about:blank').catch(() => {});
    }
    if (wasActive) this.deps.onActive(null);
  }

  setBounds(bounds: Bounds): void {
    if (this.view && this.activeView) this.view.setBounds(bounds);
  }

  /** A view changed on disk: reload it, debounced, so a file-at-a-time write is one reload. */
  scheduleReload(name: string): void {
    if (this.activeView !== name) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      const contents = this.contents();
      if (contents && this.activeView === name) contents.reload();
    }, RELOAD_DEBOUNCE_MS);
  }

  destroy(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    if (this.view) this.deps.unmount(this.view);
    this.view?.webContents.close();
    this.view = null;
    this.activeView = null;
  }

  private ensure(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        // Not persist:x: a view never sees the X session's cookies, and nothing it stores survives.
        partition: this.deps.partition,
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    attachCanvasNavigationPolicy(contents, () => (this.activeView ? viewOrigin(this.activeView) : null));
    contents.on('console-message', (details) => {
      if (this.activeView) this.logs.add(this.activeView, { source: 'console', level: details.level, text: details.message });
    });
    contents.on('preload-error', (_e, preloadPath, error) => {
      if (this.activeView) this.logs.add(this.activeView, { source: 'preload', level: 'error', text: `${preloadPath}: ${error.message}` });
    });
    contents.on('render-process-gone', (_e, details) => {
      const name = this.activeView;
      if (!name) return;
      this.logs.add(name, { source: 'crash', level: 'error', text: `renderer gone (${details.reason})` });
      this.hide();
      this.deps.onFailure(name, `the view's renderer stopped (${details.reason})`);
    });
    contents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: a load we replaced ourselves, not one that failed.
      if (!isMainFrame || errorCode === -3) return;
      const name = this.activeView;
      if (!name) return;
      this.logs.add(name, { source: 'crash', level: 'error', text: `load failed: ${errorDescription}` });
      this.hide();
      this.deps.onFailure(name, errorDescription);
    });
    this.view = view;
    return view;
  }
}
