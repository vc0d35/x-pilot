import type { AgentEvent, AgentStatus, ApprovalRequest, UserInputAnswers, UserInputRequest } from '../shared/agent';

export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  streaming?: boolean;
}
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  status: 'running' | 'done' | 'failed';
  output?: string;
}
export interface ThinkingStep {
  id: string;
  text: string;
}
export type Entry =
  | { kind: 'message'; message: Message }
  | { kind: 'thinking'; id: string; steps: ThinkingStep[] }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'approval'; request: ApprovalRequest; decision?: string; note?: string }
  | { kind: 'input'; request: UserInputRequest; resolved?: { answers: UserInputAnswers } };

/**
 * The scheduled run the sidebar is showing instead of the user's own conversation. It is read-only:
 * the run has its own Codex process, and its events arrive on their own channel.
 */
export interface ViewingRun {
  threadId: string;
  taskId: number | null;
  title: string;
  running: boolean;
}

/** Everything the sidebar dispatches that is not an agent event of the live conversation. */
export type LocalAction =
  | { type: 'reset' }
  | { type: 'view.task'; threadId: string; taskId: number | null; title: string; running: boolean }
  | { type: 'view.live' }
  | { type: 'conversation.event'; threadId: string; event: AgentEvent };

export interface State {
  status: AgentStatus;
  statusMessage?: string;
  threadId: string | null;
  running: boolean;
  entries: Entry[];
  activity: { activity: 'thinking' | 'tool' | 'writing' | 'waiting'; detail?: string } | null;
  /** Id of the turn in progress; thinking events are folded into one entry per turn. */
  turnId: string | null;
  /** Last thing that went wrong (a failed status or a failed turn); cleared when the agent restarts. */
  failure: { message: string } | null;
  /** True once a turn has completed in this session, so a stale failure stops shaping the UI. */
  everSucceeded: boolean;
  /** Set while a scheduled run is being read instead of the live conversation. */
  viewing: ViewingRun | null;
}

export const initialState: State = {
  status: 'starting',
  threadId: null,
  running: false,
  entries: [],
  activity: null,
  turnId: null,
  failure: null,
  everSucceeded: false,
  viewing: null,
};

let seq = 0;
const localId = () => `local-${++seq}`;

export function reduce(state: State, e: AgentEvent | LocalAction): State {
  switch (e.type) {
    case 'reset':
      return { ...state, entries: [], running: false, failure: null, viewing: null };
    case 'view.task':
      return { ...state, viewing: { threadId: e.threadId, taskId: e.taskId, title: e.title, running: e.running } };
    case 'view.live':
      return { ...state, viewing: null };
    case 'conversation.event': {
      const viewing = state.viewing;
      if (!viewing || viewing.threadId !== e.threadId) return state;
      const next = reduce(state, e.event);
      if (e.event.type !== 'turn.completed') return next;
      // The run's turn ending is the run's news, not the live agent's: keep its own health fields.
      return {
        ...next,
        status: state.status,
        statusMessage: state.statusMessage,
        running: state.running,
        failure: state.failure,
        everSucceeded: state.everSucceeded,
        viewing: { ...viewing, running: false },
      };
    }
    case 'status': {
      // 'starting' is the one status that means a fresh attempt, so it is what clears a failure:
      // 'ready' follows a failed turn (Codex reports auth errors there) and must not clear it.
      const failure =
        e.status === 'error' || e.status === 'disconnected'
          ? { message: e.message ?? `Agent ${e.status}` }
          : e.status === 'starting'
            ? null
            : state.failure;
      return { ...state, status: e.status, statusMessage: e.message, running: e.status === 'running', failure };
    }
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
      const failed = e.status === 'failed';
      const entries = failed
        ? [
            ...state.entries,
            {
              kind: 'message' as const,
              message: { id: localId(), role: 'system' as const, text: `Turn failed: ${e.error ?? 'unknown error'}` },
            },
          ]
        : state.entries;
      return {
        ...state,
        running: false,
        entries,
        activity: null,
        failure: failed ? { message: e.error ?? 'unknown error' } : null,
        everSucceeded: state.everSucceeded || e.status === 'completed',
      };
    }
    case 'message.delta': {
      const idx = state.entries.findIndex((en) => en.kind === 'message' && en.message.id === e.itemId);
      if (idx < 0)
        return {
          ...state,
          entries: [...state.entries, { kind: 'message', message: { id: e.itemId, role: 'agent', text: e.delta, streaming: true } }],
        };
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
      return {
        ...state,
        entries: [...state.entries, { kind: 'tool', call: { id: e.itemId, name: e.name, args: e.args, status: 'running' } }],
      };
    case 'tool.completed': {
      const idx = state.entries.findIndex((en) => en.kind === 'tool' && en.call.id === e.itemId);
      const call: ToolCall = {
        id: e.itemId,
        name: e.name,
        args: idx >= 0 ? (state.entries[idx] as { call: ToolCall }).call.args : undefined,
        status: e.success ? 'done' : 'failed',
        output: e.output,
      };
      return {
        ...state,
        entries:
          idx < 0 ? [...state.entries, { kind: 'tool', call }] : state.entries.map((en, i) => (i === idx ? { kind: 'tool', call } : en)),
      };
    }
    case 'approval.requested':
      return { ...state, entries: [...state.entries, { kind: 'approval', request: e.request }] };
    case 'approval.resolved':
      return {
        ...state,
        entries: state.entries.map((en) =>
          en.kind === 'approval' && en.request.id === e.id ? { ...en, decision: e.decision, note: e.note } : en,
        ),
      };
    case 'input.requested':
      return { ...state, entries: [...state.entries, { kind: 'input', request: e.request }] };
    case 'input.resolved':
      return {
        ...state,
        entries: state.entries.map((en) =>
          en.kind === 'input' && en.request.id === e.id ? { ...en, resolved: { answers: e.answers } } : en,
        ),
      };
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
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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

function applyThinking(
  entries: Entry[],
  turnId: string,
  e: Extract<AgentEvent, { type: 'thinking.delta' | 'thinking.completed' }>,
): Entry[] {
  const idx = entries.findIndex((en) => en.kind === 'thinking' && en.id === turnId);
  const entry: Extract<Entry, { kind: 'thinking' }> =
    idx >= 0 ? (entries[idx] as Extract<Entry, { kind: 'thinking' }>) : { kind: 'thinking', id: turnId, steps: [] };
  const steps = entry.steps.slice();
  const si = steps.findIndex((st) => st.id === e.itemId);
  const text = e.type === 'thinking.completed' ? e.text : (si >= 0 ? steps[si].text : '') + e.delta;
  if (si >= 0) steps[si] = { id: e.itemId, text };
  else steps.push({ id: e.itemId, text });
  const updated = { ...entry, steps };
  return idx >= 0 ? entries.map((en, i) => (i === idx ? updated : en)) : [...entries, updated];
}
