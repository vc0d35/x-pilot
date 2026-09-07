import type { AgentEvent } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { Settings } from '../../shared/settings';
import type { ToolSpec } from '../../shared/tools';
import type { ModelInfo } from '../../shared/sidebar-api';

export type { ModelInfo };

export interface StartOptions {
  tools: ToolSpec[];
  settings: Settings['agent']['codex'];
  threadId?: string | null;
  workspaceDir: string;
}

export interface AgentProvider {
  readonly id: string;
  start(opts: StartOptions): Promise<{ threadId: string }>;
  send(text: string, pageContext?: PageContext | null): Promise<void>;
  interrupt(): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  isRunning(): boolean;
  stop(): Promise<void>;
}
