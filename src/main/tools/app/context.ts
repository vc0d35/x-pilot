import type { CallOrigin } from '../../../shared/tools';
import type { AppStore } from '../../history/store';
import type { ApprovalBroker } from '../../approvals';
import type { PageStyles } from '../../page-config/styles';
import type { SelectorOverrides } from '../../page-config/selectors';
import type { TaskManager } from '../../tasks/manager';
import type { SelectorKey } from '../../../shared/selectors';
import type { ViewsStore } from '../../views/store';
import type { ActiveViewState, ViewErrorPhase, ViewLogEntry } from '../../../shared/views';
import type { ViewInspection } from '../../views/inspect';

/** The custom views the agent writes, and the one window they are shown in. */
export interface ViewsCtx {
  store: ViewsStore;
  /** The view on screen now, or null when the user is looking at X. */
  active(): string | null;
  /** Puts a view on screen; resolves with why it could not be shown, or null when it is up. */
  show(view: string): Promise<string | null>;
  hide(): void;
  /**
   * A view that could not be put on screen at all — no index.html when it was asked for. Nothing
   * comes off the screen, but the user is told and the remembered view is forgotten.
   */
  failed(view: string, phase: ViewErrorPhase, message: string): void;
  /**
   * Marks the view on screen as one the user has not decided on yet. A preview renders and reads;
   * the bridge refuses the drivers and the writes until it is kept.
   */
  preview(previewing: boolean): void;
  /** Records the view to bring back at the next start, or clears it. */
  persist(view: string | null): void;
  /** Whether activating a view is previewed and confirmed, or just done. */
  mode(): 'confirm' | 'autonomous';
  logs(view?: string, limit?: number): ViewLogEntry[];
  /**
   * The view on screen and what it last published about itself, or null when the user is on x.com.
   * A view that publishes is saying what "this post" means while it is up.
   */
  state(): ActiveViewState | null;
  /** Hands one message to the view on screen; false when there is none to hand it to. */
  message(data: Record<string, unknown>): boolean;
  /** Looks at the DOM the view rendered; null when no view is on screen. */
  inspect(selector?: string, limit?: number): Promise<ViewInspection | { error: string } | null>;
}

/** What a selector does on the page the user is looking at, as the preload reports it. */
export interface SelectorTest {
  valid: boolean;
  count: number;
}

export interface AppToolCtx {
  /** Who asked; absent for the agent's own calls. See `XViewToolCtx.origin`. */
  origin?: CallOrigin;
  store: AppStore;
  tasks: TaskManager;
  styles: PageStyles;
  selectors: SelectorOverrides;
  approvals: ApprovalBroker;
  views: ViewsCtx;
  /** Whether an agent-written stylesheet is confirmed by the user before it is applied. */
  stylesMode: () => 'confirm' | 'autonomous';
  /** Tries a selector on the visible page; null in a scheduled run, which has no visible view. */
  testSelector: ((selector: string) => Promise<SelectorTest | null>) | null;
  libraryDir(): string;
  exportPdf(url: string, outDir: string, selectors: Record<SelectorKey, string>): Promise<{ path: string; title: string }>;
  openPath: (path: string) => Promise<string>; // resolves '' on success, error text otherwise (shell.openPath semantics)
}
