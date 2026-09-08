import type { AgentEvent, AgentStatus, ApprovalRequest } from '../shared/agent';

export interface Message { id: string; role: 'user' | 'agent' | 'system'; text: string; streaming?: boolean }
export interface ToolCall { id: string; name: string; args: unknown; status: 'running' | 'done' | 'failed'; output?: string }
export interface ThinkingStep { id: string; text: string }
export type Entry =
  | { kind: 'message'; message: Message }
  | { kind: 'thinking'; id: string; steps: ThinkingStep[] }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'approval'; request: ApprovalRequest; decision?: string };

export interface State {
  status: AgentStatus;
  statusMessage?: string;
  threadId: string | null;
  running: boolean;
  entries: Entry[];
  activity: { activity: 'thinking' | 'tool' | 'writing'; detail?: string } | null;
  /** Id of the turn in progress; thinking events are folded into one entry per turn. */
  turnId: string | null;
}

export const initialState: State = { status: 'starting', threadId: null, running: false, entries: [], activity: null, turnId: null };

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
      return { ...state, running: true, activity: null, turnId: e.turnId };
    case 'thinking.delta':
    case 'thinking.completed':
      return { ...state, entries: applyThinking(state.entries, state.turnId ?? 'turn', e) };
    case 'activity':
      return { ...state, activity: e.detail ? { activity: e.activity, detail: e.detail } : { activity: e.activity } };
    case 'turn.completed': {
      const entries = e.status === 'failed'
        ? [...state.entries, { kind: 'message' as const, message: { id: localId(), role: 'system' as const, text: `Turn failed: ${e.error ?? 'unknown error'}` } }]
        : state.entries;
      return { ...state, running: false, entries, activity: null };
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

/**
 * A tool reports a broken X adapter with `adapterHealthy: false` in its JSON output. The shape
 * around it varies by tool and by provider (a bare object, an MCP result, a JSON string inside a
 * text block), so search the parsed output instead of assuming a fixed position.
 */
export function reportsBrokenAdapter(output: string | undefined): boolean {
  return hasBrokenAdapter(parseJson(output));
}

function parseJson(text: string | undefined): unknown {
  if (typeof text !== 'string' || text === '') return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

function hasBrokenAdapter(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return value.includes('adapterHealthy') && hasBrokenAdapter(parseJson(value), depth + 1);
  if (Array.isArray(value)) return value.some((v) => hasBrokenAdapter(v, depth + 1));
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.adapterHealthy === false) return true;
  return Object.values(record).some((v) => hasBrokenAdapter(v, depth + 1));
}

function applyThinking(entries: Entry[], turnId: string, e: Extract<AgentEvent, { type: 'thinking.delta' | 'thinking.completed' }>): Entry[] {
  const idx = entries.findIndex((en) => en.kind === 'thinking' && en.id === turnId);
  const entry: Extract<Entry, { kind: 'thinking' }> = idx >= 0 ? (entries[idx] as Extract<Entry, { kind: 'thinking' }>) : { kind: 'thinking', id: turnId, steps: [] };
  const steps = entry.steps.slice();
  const si = steps.findIndex((st) => st.id === e.itemId);
  const text = e.type === 'thinking.completed' ? e.text : (si >= 0 ? steps[si].text : '') + e.delta;
  if (si >= 0) steps[si] = { id: e.itemId, text }; else steps.push({ id: e.itemId, text });
  const updated = { ...entry, steps };
  return idx >= 0 ? entries.map((en, i) => (i === idx ? updated : en)) : [...entries, updated];
}
