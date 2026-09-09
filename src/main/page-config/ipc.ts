import { IPC, type PageConfig } from '../../shared/ipc';

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
  send(id: number, channel: string, payload: PageConfig): void;
}

/**
 * Answers the preload's startup request and pushes later changes. Styles reach the visible view
 * only: a hidden window reads the DOM, and a rule like `display: none` would make it skip content.
 * Selector overrides reach every X view, because the adapter must read the same page the same way
 * wherever it runs.
 */
export function registerPageConfigIpc(deps: PageConfigIpcDeps): void {
  const configFor = (id: number): PageConfig => ({
    styles: deps.isVisibleContents(id) ? deps.styles.get() : null,
    selectors: deps.selectors.overrides(),
  });
  deps.ipc.on(IPC.pageConfigGet, (event) => {
    // Always answered: a sendSync left without a reply would hang the page before it renders.
    event.returnValue = deps.isXContents(event.sender.id) ? configFor(event.sender.id) : null;
  });
  const push = (): void => {
    for (const id of deps.xContentsIds()) deps.send(id, IPC.pageConfigUpdate, configFor(id));
  };
  deps.styles.onChange(push);
  deps.selectors.onChange(push);
}
