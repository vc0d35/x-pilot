import { IPC, type PageConfig, type PageStylesPreview } from '../../shared/ipc';

/** The sync half of `ipcMain`: the reply is the value assigned to `returnValue`. */
export interface PageConfigIpcEvent {
  sender: { id: number };
  returnValue: unknown;
}
export interface PageConfigIpc {
  on(channel: string, listener: (event: PageConfigIpcEvent, payload: unknown) => void): void;
}

/** What a page-config store looks like from here: the current text, and a way to hear it change. */
export interface PageConfigStyles {
  get(): string;
  onChange(cb: (css: string) => void): () => void;
  /** A sheet the user is being shown before it is written, or null when there is none. */
  onPreview(cb: (css: string | null) => void): () => void;
}

/** The selector overrides, as the same pair: what to apply now, and a way to hear it change. */
export interface PageConfigSelectors {
  overrides(): Partial<Record<string, string>>;
  onChange(cb: () => void): () => void;
}

export interface PageConfigIpcDeps {
  ipc: PageConfigIpc;
  /** True for the X views this app created; nothing else is answered. */
  isXContents(id: number): boolean;
  /** True for the view the user is looking at: the only one styles are delivered to. */
  isVisibleContents(id: number): boolean;
  styles: PageConfigStyles;
  selectors: PageConfigSelectors;
  /** Every live X view, visible and hidden, in the order a push should reach them. */
  xContentsIds(): number[];
  /** Sends to one X view; a function so the wiring is testable without a WebContents. */
  send(id: number, channel: string, payload: PageConfig | PageStylesPreview): void;
}

/**
 * Answers the preload's startup request and pushes later changes. Styles reach the visible view
 * only: a hidden window reads the DOM, and a rule like `display: none` would make it skip content.
 * Selector overrides reach every X view, because the adapter must read the same page the same way
 * wherever it runs.
 */
export function registerPageConfigIpc(deps: PageConfigIpcDeps): void {
  /**
   * Never throws. The stores answer from memory, but a reply this handler failed to assign would
   * leave the page blocked in `sendSync` for good, so an unstyled, unmodified page is the fallback.
   */
  const configFor = (id: number): PageConfig => {
    try {
      return {
        styles: deps.isVisibleContents(id) ? deps.styles.get() : null,
        selectors: deps.selectors.overrides(),
      };
    } catch (err) {
      console.error('[xpilot] page config could not be read; the page gets none', err);
      return { styles: null, selectors: {} };
    }
  };
  deps.ipc.on(IPC.pageConfigGet, (event) => {
    // Always answered: a sendSync left without a reply would hang the page before it renders.
    try {
      event.returnValue = deps.isXContents(event.sender.id) ? configFor(event.sender.id) : null;
    } catch (err) {
      console.error('[xpilot] page config request could not be answered', err);
      event.returnValue = null;
    }
  });
  const push = (): void => {
    for (const id of deps.xContentsIds()) deps.send(id, IPC.pageConfigUpdate, configFor(id));
  };
  deps.styles.onChange(push);
  deps.selectors.onChange(push);
  // A preview is what the user is deciding about, so it goes to the view they are looking at and
  // nowhere else; the hidden readers must keep seeing the page as X ships it.
  deps.styles.onPreview((css) => {
    for (const id of deps.xContentsIds()) {
      if (deps.isVisibleContents(id)) deps.send(id, IPC.pageConfigPreview, { css });
    }
  });
}
