export type AgentStatus = 'starting' | 'ready' | 'running' | 'disconnected' | 'error';

export interface ApprovalOption { id: string; label: string }
export interface ApprovalRequest {
  id: string;
  kind: 'command' | 'fileChange' | 'post';
  title: string;
  detail: string;
  options: ApprovalOption[];
}

export type AgentEvent =
  | { type: 'status'; status: AgentStatus; message?: string }
  | { type: 'thread'; threadId: string }
  | { type: 'user.message'; text: string }
  | { type: 'turn.started'; turnId: string }
  | { type: 'turn.completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed'; error?: string }
  | { type: 'message.delta'; itemId: string; delta: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'tool.started'; itemId: string; name: string; args: unknown }
  | { type: 'tool.completed'; itemId: string; name: string; success: boolean; output: string }
  | { type: 'approval.requested'; request: ApprovalRequest }
  | { type: 'approval.resolved'; id: string; decision: string };
