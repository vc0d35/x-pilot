import type { AgentEvent, AgentStatus, ApprovalRequest } from '../shared/agent';

export interface Message { id: string; role: 'user' | 'agent' | 'system'; text: string; streaming?: boolean }
export interface ToolCall { id: string; name: string; args: unknown; status: 'running' | 'done' | 'failed'; output?: string }
export type Entry =
  | { kind: 'message'; message: Message }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'approval'; request: ApprovalRequest; decision?: string };

export interface State {
  status: AgentStatus;
  statusMessage?: string;
  threadId: string | null;
  running: boolean;
  entries: Entry[];
}

export const initialState: State = { status: 'starting', threadId: null, running: false, entries: [] };

let seq = 0;
const localId = () => `local-${++seq}`;

export function reduce(state: State, e: AgentEvent | { type: 'reset' }): State {
  switch (e.type) {
    case 'reset':
      return { ...state, entries: [], running: false };
    case 'status':
      return { ...state, status: e.status, statusMessage: e.message, running: e.status === 'running' };
    case 'thread':
      return { ...state, threadId: e.threadId };
    case 'user.message':
      return { ...state, entries: [...state.entries, { kind: 'message', message: { id: localId(), role: 'user', text: e.text } }] };
    case 'turn.started':
      return { ...state, running: true };
    case 'turn.completed': {
      const entries = e.status === 'failed'
        ? [...state.entries, { kind: 'message' as const, message: { id: localId(), role: 'system' as const, text: `Turn failed: ${e.error ?? 'unknown error'}` } }]
        : state.entries;
      return { ...state, running: false, entries };
    }
    case 'message.delta': {
      const idx = state.entries.findIndex((en) => en.kind === 'message' && en.message.id === e.itemId);
      if (idx < 0) return { ...state, entries: [...state.entries, { kind: 'message', message: { id: e.itemId, role: 'agent', text: e.delta, streaming: true } }] };
      const entry = state.entries[idx] as { kind: 'message'; message: Message };
      const updated = { ...entry, message: { ...entry.message, text: entry.message.text + e.delta } };
      return { ...state, entries: state.entries.map((en, i) => (i === idx ? updated : en)) };
    }
    case 'message.completed': {
      const idx = state.entries.findIndex((en) => en.kind === 'message' && en.message.id === e.itemId);
      const final = { kind: 'message' as const, message: { id: e.itemId, role: 'agent' as const, text: e.text, streaming: false } };
      return { ...state, entries: idx < 0 ? [...state.entries, final] : state.entries.map((en, i) => (i === idx ? final : en)) };
    }
    case 'tool.started':
      return { ...state, entries: [...state.entries, { kind: 'tool', call: { id: e.itemId, name: e.name, args: e.args, status: 'running' } }] };
    case 'tool.completed': {
      const idx = state.entries.findIndex((en) => en.kind === 'tool' && en.call.id === e.itemId);
      const call: ToolCall = { id: e.itemId, name: e.name, args: idx >= 0 ? (state.entries[idx] as { call: ToolCall }).call.args : undefined, status: e.success ? 'done' : 'failed', output: e.output };
      return { ...state, entries: idx < 0 ? [...state.entries, { kind: 'tool', call }] : state.entries.map((en, i) => (i === idx ? { kind: 'tool', call } : en)) };
    }
    case 'approval.requested':
      return { ...state, entries: [...state.entries, { kind: 'approval', request: e.request }] };
    case 'approval.resolved':
      return { ...state, entries: state.entries.map((en) => (en.kind === 'approval' && en.request.id === e.id ? { ...en, decision: e.decision } : en)) };
    default:
      return state;
  }
}
