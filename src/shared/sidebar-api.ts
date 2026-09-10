import type { AgentEvent, ProviderKind, UserInputAnswers } from './agent';
import type { PageContext } from './page';
import type { DeepPartial, Settings } from './settings';
import type { ViewsStatus } from './views';
export type { ViewsStatus, ViewSummary } from './views';

export interface ModelInfo {
  id: string;
  displayName: string;
  isDefault: boolean;
  reasoningEfforts: string[];
}
/** One provider's models, and whether we could offer any at all. */
export interface ModelList {
  provider: ProviderKind;
  models: ModelInfo[];
  /** True when the list is empty because the provider could not be asked, not because it has none. */
  unavailable: boolean;
}

/** What the Connect button came back with; `model` is the one the turn ran on. */
export type ProbeResult = { ok: true; model: string | null } | { ok: false; error: string };

export interface Conversation {
  threadId: string;
  title: string;
  kind: 'chat' | 'task';
  /** The backend that wrote it; only that one can continue it. */
  provider: ProviderKind;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
  toolsHash: string | null;
}
/**
 * What the sidebar is looking at after it opened a conversation. A scheduled run is a read-only
 * view: the interactive agent stays on its own thread, and the run's events stream in while it
 * is still going. So is a conversation another provider owns: it can be read, never continued.
 */
export type ConversationView =
  | { threadId: string; kind: 'live' }
  | { threadId: string; kind: 'task'; taskId: number | null; title: string; running: boolean }
  /** A conversation the other provider wrote: readable, not resumable. */
  | { threadId: string; kind: 'foreign'; provider: ProviderKind };

export interface OpenedConversation {
  events: AgentEvent[];
  view: ConversationView;
}

/** One transcript event of a conversation the sidebar is not driving, pushed as it is recorded. */
export interface ConversationEventMessage {
  threadId: string;
  event: AgentEvent;
}

export type TaskSchedule = { every: string } | { cron: string };
/** What the last attempt at a run came to; 'deferred' means the user was active and it was put off. */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'deferred';
export interface ScheduledTask {
  id: number;
  title: string;
  prompt: string;
  schedule: TaskSchedule;
  threadMode: 'resume' | 'new';
  threadId: string | null;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastStatus: TaskStatus | null;
  nextRunAt: string | null;
  /** Whether this task's unattended runs may use Codex's web search; off unless the task needs it. */
  webSearch: boolean;
  /** The largest post id a run of this task has read from a timeline, so the next run can skip it. */
  lastSeenPostId: string | null;
  /**
   * Whether a run drives the window the user is looking at, with the screen tools, instead of a
   * hidden one. Only set when the user asked for it; a run is deferred while the user is active.
   */
  visibleWindow: boolean;
}
/** Which of the two page-config files a Settings row is about. */
export type PageConfigKind = 'styles' | 'selectors';

/**
 * The two user-editable page-config files as Settings shows them. `lastError` is why what is on
 * disk is not what is in effect — a stylesheet that failed the check, a selectors.json that would
 * not parse — and is null when the file and the app agree.
 */
export interface PageConfigStatus {
  styles: { path: string; lastError: string | null };
  selectors: { path: string; overridden: number; stale: number; lastError: string | null };
}
export interface HistoryStats {
  conversations: number;
  events: number;
  posts: number;
  library: number;
  tasks: number;
  dbBytes: number;
}
export interface LibraryItem {
  id: number;
  url: string;
  path: string;
  title: string;
  savedAt: string;
}

export interface XPilotApi {
  send(text: string, pageContext: PageContext | null): Promise<void>;
  interrupt(): Promise<void>;
  newThread(): Promise<void>;
  reconnect(): Promise<void>;
  /** `note` is what the user typed on an option that asked for one; the transcript shows it. */
  resolveApproval(id: string, decision: string, note?: string): Promise<void>;
  /** Answers a clarifying question from the agent; null answers mean the user skipped it. */
  resolveInput(id: string, answers: UserInputAnswers): Promise<void>;
  /** The models to offer; omit `provider` for the one that is running. */
  listModels(provider?: ProviderKind): Promise<ModelList>;
  /** Records the chosen backend and starts a fresh thread on it. */
  setProvider(provider: ProviderKind): Promise<void>;
  /** Connect: one short turn on a throwaway instance of that provider, to prove it answers. */
  probeProvider(provider: ProviderKind): Promise<ProbeResult>;
  getSettings(): Promise<Settings>;
  setSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  listLibrary(): Promise<LibraryItem[]>;
  listConversations(): Promise<Conversation[]>;
  listTasks(): Promise<ScheduledTask[]>;
  updateTask(id: number, patch: { enabled?: boolean }): Promise<ScheduledTask>;
  deleteTask(id: number): Promise<void>;
  runTaskNow(id: number): Promise<void>;
  /** Stops the scheduled run in flight; the run is recorded as interrupted. */
  stopTaskRun(): Promise<void>;
  openConversation(threadId: string): Promise<OpenedConversation>;
  openPdf(path: string): Promise<void>;
  chooseLibraryDir(): Promise<string | null>;
  /** Where the page stylesheet and the selector overrides live, and what state they are in. */
  pageConfigStatus(): Promise<PageConfigStatus>;
  openPageConfig(kind: PageConfigKind): Promise<void>;
  /** Empties one of the two files, as the user, so nothing is confirmed; returns the new status. */
  resetPageConfig(kind: PageConfigKind): Promise<PageConfigStatus>;
  /** The custom views in the profile and which one is on screen. */
  viewsStatus(): Promise<ViewsStatus>;
  /** Back to X: takes the custom view off the screen and forgets it for the next start. */
  deactivateView(): Promise<void>;
  /** Opens the views folder in the file manager; only that folder. */
  openViewsFolder(): Promise<void>;
  /** Picks that provider's binary with a file dialog, or clears it; returns the new path. */
  setProviderBinary(provider: ProviderKind, action: 'choose' | 'clear'): Promise<string | null>;
  clearHistory(): Promise<void>;
  historyStats(): Promise<HistoryStats>;
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
  /** Opens a link the user clicked in the sidebar: x.com in the main window, anything else in the browser. */
  openLink(url: string): Promise<void>;
  onSidebarCollapsed(cb: (collapsed: boolean) => void): () => void;
  onFocusInput(cb: () => void): () => void;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  /** Transcript events of a scheduled run, so a run opened from History streams while it runs. */
  onConversationEvent(cb: (m: ConversationEventMessage) => void): () => void;
  onFocus(cb: (ctx: PageContext | null) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
}
