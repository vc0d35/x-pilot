import { WebContentsView, type WebContents } from 'electron';
import {
  VIEW_ENTRY_FILE,
  VIEW_LOG_LIMIT,
  VIEW_LOG_TEXT_MAX,
  VIEW_STORM_MESSAGE,
  VIEW_UNRESPONSIVE_MS,
  type ViewErrorPhase,
  type ViewErrorReport,
  type ViewLogEntry,
} from '../../shared/views';
import { ViewErrorCounters, formatWhere } from './errors';
import { viewOrigin, viewUrl } from './serve';
import type { Bounds } from '../layout';

const RELOAD_DEBOUNCE_MS = 300;

/** The last few lines each view produced, oldest dropped: a view is debugged from here, not a console. */
export class ViewLogs {
  private readonly byView = new Map<string, ViewLogEntry[]>();

  add(view: string, entry: Omit<ViewLogEntry, 'at'> & { at?: string }): void {
    const entries = this.byView.get(view) ?? [];
    entries.push({
      at: entry.at ?? new Date().toISOString(),
      source: entry.source,
      level: entry.level,
      text: cut(entry.text),
      ...(entry.where ? { where: entry.where } : {}),
    });
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
  /**
   * Something went wrong in a view. A `fatal` one is already off the screen — the app has fallen
   * back to the X page underneath — and everything else is a view that is still up and rendering.
   */
  onError(failure: ViewFailure): void;
  /** Which view is on screen now, for the sidebar banner. */
  onActive(view: string | null): void;
}

/** One thing that went wrong in a view, as the sidebar and the settings need to hear it. */
export interface ViewFailure {
  view: string;
  phase: ViewErrorPhase;
  message: string;
  /** True when the view is off the screen because of it, so the remembered view is forgotten too. */
  fatal: boolean;
}

/**
 * The third view: a sandboxed, network-less renderer on its own session that shows one custom view
 * over the X page. It is created the first time a view is shown and kept afterwards, because
 * showing and hiding a view is something the user does repeatedly while the agent is building one.
 */
export class ViewCanvas {
  private view: WebContentsView | null = null;
  private activeView: string | null = null;
  private previewingView = false;
  private reloadTimer: NodeJS.Timeout | null = null;
  private loading = false;
  /** Running while a wedged renderer is being given its ten seconds to come back. */
  private unresponsiveTimer: NodeJS.Timeout | null = null;
  readonly logs = new ViewLogs();
  private readonly errors: ViewErrorCounters;

  constructor(
    private readonly deps: ViewCanvasDeps,
    now: () => number = Date.now,
  ) {
    this.errors = new ViewErrorCounters(now);
  }

  active(): string | null {
    return this.activeView;
  }

  /**
   * True while the view on screen is only being shown for the user to look at, with the "Keep this
   * view?" card unanswered. The bridge reads it: a preview may render, and nothing more.
   */
  previewing(): boolean {
    return this.previewingView;
  }

  setPreviewing(previewing: boolean): void {
    this.previewingView = previewing;
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
    this.previewingView = false;
    this.errors.activated(name);
    if (!was) this.deps.mount(view);
    view.setBounds(this.deps.bounds());
    view.webContents.setAudioMuted(false);
    // Said before the load, not after: the canvas is on screen from here, the bridge's subscriptions
    // are the old document's and have to go before the new one makes its own, and anything the page
    // says on its way up — an error thrown out of a module — has to arrive after the view it is about.
    this.deps.onActive(name);
    this.loading = true;
    try {
      await view.webContents.loadURL(viewUrl(name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ERR_ABORTED is a load replaced by a newer navigation of ours, such as a reload for a file
      // written moments earlier; the newer load carries on.
      if (/ERR_ABORTED/.test(message)) return null;
      this.failed(name, 'load', message);
      return message;
    } finally {
      this.loading = false;
    }
    return null;
  }

  hide(): void {
    this.clearTimers();
    const wasActive = this.activeView !== null;
    this.activeView = null;
    this.previewingView = false;
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.deps.unmount(this.view);
      // No navigation on hide: a blank-page load racing the next activation's load on a view whose
      // visibility just flipped crashed Electron (SIGSEGV on CI). The hidden page is stopped and
      // muted instead, and the next activation replaces it.
      this.view.webContents.stop();
      this.view.webContents.setAudioMuted(true);
    }
    if (wasActive) this.deps.onActive(null);
  }

  setBounds(bounds: Bounds): void {
    if (this.view && this.activeView) this.view.setBounds(bounds);
  }

  /** A view changed on disk: reload it, debounced, so a file-at-a-time write is one reload. */
  scheduleReload(name: string): void {
    if (this.activeView !== name || this.loading) return;
    // A view that has failed to load twice running is not reloaded a third time at the speed a
    // watcher can fire; the refusal clears the count, so the next file change tries again.
    if (!this.errors.shouldReload(name)) {
      this.logs.add(name, { source: 'crash', level: 'warn', text: 'reload skipped: the last reloads did not load' });
      return;
    }
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      const contents = this.contents();
      if (!contents || this.activeView !== name) return;
      // The canvas can be taken off the screen between the timer being set and it firing.
      try {
        // Ignoring the cache as well as answering no-store: a reload exists to show what changed.
        contents.reloadIgnoringCache();
      } catch (err) {
        console.warn(`[xpilot] could not reload the custom view ${name}`, err);
      }
    }, RELOAD_DEBOUNCE_MS);
  }

  /**
   * One error a view's own scripts threw, relayed by its preload. The view stays up — an error in a
   * render is not a reason to take the user's screen away — but it is kept with the console log and,
   * the first time after an activation and sparingly after that, said out loud in the sidebar. A
   * storm of them is different: a view erroring twenty times a minute is not rendering anything.
   */
  noteRuntimeError(report: ViewErrorReport): void {
    const name = this.activeView;
    if (!name) return;
    const where = formatWhere(report);
    this.logs.add(name, { source: 'error', level: 'error', text: report.message, ...(where ? { where } : {}) });
    const decision = this.errors.runtime(name);
    if (decision.storm) {
      this.logs.add(name, { source: 'crash', level: 'error', text: VIEW_STORM_MESSAGE });
      this.hide();
      this.deps.onError({ view: name, phase: 'runtime', message: VIEW_STORM_MESSAGE, fatal: true });
      return;
    }
    if (decision.report) this.deps.onError({ view: name, phase: 'runtime', message: report.message, fatal: false });
  }

  /**
   * A view that could not be put on screen at all: no index.html when it was activated, or a
   * remembered view that is not there any more at startup. Nothing has to come off the screen for
   * it, but the user is told the same way and the view is forgotten the same way.
   */
  reportFailure(view: string, phase: ViewErrorPhase, message: string): void {
    if (this.activeView === view) {
      this.failed(view, phase, message);
      return;
    }
    this.logs.add(view, { source: 'crash', level: 'error', text: `${phase}: ${message}` });
    this.deps.onError({ view, phase, message, fatal: true });
  }

  destroy(): void {
    this.clearTimers();
    const view = this.view;
    this.view = null;
    this.activeView = null;
    this.previewingView = false;
    if (!view || view.webContents.isDestroyed()) return;
    this.deps.unmount(view);
    // Every listener goes before the contents do: a console message, a navigation event or a
    // relayed error arriving as the app quits must not reach a handler that would touch a
    // WebContents that is on its way out.
    view.webContents.removeAllListeners();
    view.webContents.close();
  }

  private clearTimers(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    if (this.unresponsiveTimer) clearTimeout(this.unresponsiveTimer);
    this.unresponsiveTimer = null;
  }

  /**
   * A view on screen has failed fatally: it comes off, the app falls back to the X page underneath,
   * and the sidebar says why. Whichever event gets here first wins — a load that fails raises both
   * `did-fail-load` and a rejected `loadURL` — so a second one for a view already off is ignored.
   */
  private failed(view: string, phase: ViewErrorPhase, message: string): void {
    if (this.activeView !== view) return;
    // Two crashes or wedges inside five minutes is a view that cannot be retried into at all.
    const storm = (phase === 'crash' || phase === 'unresponsive') && this.errors.fatal(view);
    this.logs.add(view, { source: 'crash', level: 'error', text: `${phase}: ${message}` });
    this.hide();
    this.deps.onError(storm ? { view, phase: 'runtime', message: VIEW_STORM_MESSAGE, fatal: true } : { view, phase, message, fatal: true });
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
      },
    });
    const contents = view.webContents;
    attachCanvasNavigationPolicy(contents, () => (this.activeView ? viewOrigin(this.activeView) : null));
    contents.on('console-message', (details) => {
      if (this.activeView) this.logs.add(this.activeView, { source: 'console', level: details.level, text: details.message });
    });
    contents.on('preload-error', (_e, preloadPath, error) => {
      const name = this.activeView;
      if (!name) return;
      this.logs.add(name, { source: 'preload', level: 'error', text: `${preloadPath}: ${error.message}` });
      // Without its preload a view has no bridge and no WebRTC removal: it is not a view any more.
      this.failed(name, 'load', `the view's preload failed: ${error.message}`);
    });
    contents.on('render-process-gone', (_e, details) => {
      const name = this.activeView;
      if (!name) return;
      this.failed(name, 'crash', `the view's renderer stopped (${details.reason})`);
    });
    contents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: a load we replaced ourselves, not one that failed.
      if (!isMainFrame || errorCode === -3) return;
      const name = this.activeView;
      if (!name) return;
      this.errors.reloadFailed(name);
      this.failed(name, 'load', errorDescription);
    });
    contents.on('did-finish-load', () => {
      if (this.activeView) this.errors.loaded(this.activeView);
    });
    // A view whose index.html has been deleted under it answers 404 rather than failing to load:
    // that is a page the user cannot use, so it is a load failure like any other.
    contents.on('did-navigate', (_e, _url, httpResponseCode) => {
      const name = this.activeView;
      if (!name || httpResponseCode < 400) return;
      this.errors.reloadFailed(name);
      this.failed(name, 'load', `the view answered ${httpResponseCode}; is ${VIEW_ENTRY_FILE} still there?`);
    });
    // A wedged renderer is given ten seconds to come back before the screen is taken off it: a long
    // frame is not a failure, and a view the user is looking at is not worth losing over one.
    contents.on('unresponsive', () => {
      const name = this.activeView;
      if (!name || this.unresponsiveTimer) return;
      this.logs.add(name, { source: 'crash', level: 'warn', text: 'the view stopped responding' });
      this.unresponsiveTimer = setTimeout(() => {
        this.unresponsiveTimer = null;
        if (this.activeView !== name) return;
        this.failed(name, 'unresponsive', `the view stopped responding for ${VIEW_UNRESPONSIVE_MS / 1000} s`);
      }, VIEW_UNRESPONSIVE_MS);
    });
    contents.on('responsive', () => {
      if (!this.unresponsiveTimer) return;
      clearTimeout(this.unresponsiveTimer);
      this.unresponsiveTimer = null;
      if (this.activeView) this.logs.add(this.activeView, { source: 'crash', level: 'info', text: 'the view started responding again' });
    });
    this.view = view;
    return view;
  }
}
