import type { AgentEvent, ProviderKind } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { ActiveViewState } from '../../shared/views';
import type { Settings } from '../../shared/settings';
import type { ToolSpec } from '../../shared/tools';
import type { ModelInfo } from '../../shared/sidebar-api';

export type { ModelInfo, ProviderKind };

/** What the rest of the app must know about a backend's thread model. */
export interface ProviderCapabilities {
  /**
   * The tool list is fixed when a thread is created, so a thread started with a different tool set
   * cannot be resumed and the controller starts a fresh one instead.
   */
  toolsFrozenPerThread: boolean;
}

export interface StartOptions {
  tools: ToolSpec[];
  /** The whole `agent` settings slice; each provider reads its own part of it. */
  settings: Settings['agent'];
  threadId?: string | null;
  workspaceDir: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  start(opts: StartOptions): Promise<{ threadId: string }>;
  /**
   * One turn. `activeView` is the custom view on the user's screen, if there is one, and whatever it
   * has published about itself: it leads the turn hint, because it is what the user is looking at.
   */
  send(text: string, pageContext?: PageContext | null, activeView?: ActiveViewState | null): Promise<void>;
  interrupt(): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  isRunning(): boolean;
  stop(): Promise<void>;
}
