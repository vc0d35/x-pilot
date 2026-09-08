import type { AgentEvent } from './agent';
import type { PageContext } from './page';
import type { DeepPartial, Settings } from './settings';

export interface ModelInfo { id: string; displayName: string; isDefault: boolean; reasoningEfforts: string[] }
export interface LibraryItem { id: number; url: string; path: string; title: string; savedAt: string }

export interface XPilotApi {
  send(text: string, pageContext: PageContext | null): Promise<void>;
  interrupt(): Promise<void>;
  newThread(): Promise<void>;
  reconnect(): Promise<void>;
  resolveApproval(id: string, decision: string): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  getSettings(): Promise<Settings>;
  setSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  listLibrary(): Promise<LibraryItem[]>;
  openPdf(path: string): Promise<void>;
  chooseLibraryDir(): Promise<string | null>;
  clearHistory(): Promise<void>;
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
  onSidebarCollapsed(cb: (collapsed: boolean) => void): () => void;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onFocus(cb: (ctx: PageContext | null) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
}
