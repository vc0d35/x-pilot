/** The agent backends XPilot can drive; `null` in settings means the user has not chosen yet. */
export const PROVIDER_KINDS = ['codex', 'claude'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const PROVIDER_LABELS: Record<ProviderKind, string> = { codex: 'Codex', claude: 'Claude' };

export type AgentStatus = 'starting' | 'ready' | 'running' | 'disconnected' | 'error';

export interface ApprovalOption {
  id: string;
  label: string;
  /** Reveals a note field on the card; the decision comes back with what the user typed. */
  note?: boolean;
}
export interface ApprovalRequest {
  id: string;
  kind: 'command' | 'fileChange' | 'post';
  title: string;
  /** One line above the detail, for what the detail alone does not show - a size, a count, a scope. */
  summary?: string;
  detail: string;
  options: ApprovalOption[];
}

/** One clarifying question Codex asked; `options` makes it a choice, `secret` hides what is typed. */
export interface UserInputQuestion {
  id: string;
  prompt: string;
  options?: string[];
  secret?: boolean;
}
export interface UserInputRequest {
  id: string;
  questions: UserInputQuestion[];
}
/** Answers by question id; null means the user skipped, or nobody answered in time. */
export type UserInputAnswers = Record<string, string> | null;

export type AgentEvent =
  | { type: 'status'; status: AgentStatus; message?: string }
  | { type: 'thread'; threadId: string }
  | { type: 'user.message'; text: string }
  | { type: 'turn.started'; turnId: string }
  | { type: 'turn.completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed'; error?: string }
  | { type: 'thinking.delta'; itemId: string; delta: string }
  | { type: 'thinking.completed'; itemId: string; text: string }
  | { type: 'message.delta'; itemId: string; delta: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'activity'; activity: 'thinking' | 'tool' | 'writing' | 'waiting'; detail?: string }
  | { type: 'tool.started'; itemId: string; name: string; args: unknown }
  | { type: 'tool.completed'; itemId: string; name: string; success: boolean; output: string }
  | { type: 'approval.requested'; request: ApprovalRequest }
  | { type: 'approval.resolved'; id: string; decision: string; note?: string }
  | { type: 'input.requested'; request: UserInputRequest }
  | { type: 'input.resolved'; id: string; answers: UserInputAnswers }
  /** A scheduled run started or ended; `visibleWindow` runs drive the window the user is looking at. */
  | { type: 'task.run'; taskId: number; title: string; visibleWindow: boolean; running: boolean }
  /**
   * Which custom view is on screen in place of x.com, or null for X itself. `error` is set when a
   * view was taken off because it would not load or its renderer died, so the sidebar can say so.
   */
  | { type: 'view.active'; view: string | null; error?: string };
