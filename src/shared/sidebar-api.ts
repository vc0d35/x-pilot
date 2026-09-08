import type { AgentEvent } from './agent';
import type { PageContext } from './page';
import type { DeepPartial, Settings } from './settings';

export interface ModelInfo { id: string; displayName: string; isDefault: boolean; reasoningEfforts: string[] }
export interface Conversation { threadId: string; title: string; kind: 'chat' | 'task'; taskId: number | null; createdAt: string; updatedAt: string }
export type TaskSchedule = { every: string } | { cron: string };
export interface ScheduledTask {
  id: number; title: string; prompt: string; schedule: TaskSchedule; threadMode: 'resume' | 'new'; threadId: string | null;
  enabled: boolean; createdAt: string; lastRunAt: string | null; lastStatus: string | null; nextRunAt: string | null;
}
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
  listConversations(): Promise<Conversation[]>;
  /** Resumes a conversation; returns its transcript to replay into the dialog. */
  openConversation(threadId: string): Promise<AgentEvent[]>;
  openPdf(path: string): Promise<void>;
  chooseLibraryDir(): Promise<string | null>;
  clearHistory(): Promise<void>;
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
  /** Opens a link the user clicked in the sidebar: x.com in the main window, anything else in the browser. */
  openLink(url: string): Promise<void>;
  onSidebarCollapsed(cb: (collapsed: boolean) => void): () => void;
  onFocusInput(cb: () => void): () => void;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onFocus(cb: (ctx: PageContext | null) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
}
