import type { AgentEvent, UserInputQuestion } from '../../../shared/agent';
import type { ToolResult } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { UserInputBroker } from '../../user-input';
import { wrapToolOutput } from '../fence';
import { JsonRpcError } from './jsonrpc';

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const QUESTION_MAX = 24;
const OPTION_MAX = 32;

export { wrapToolOutput };

/** What a stream of item notifications has to remember between them. */
export interface ItemPhases {
  /** agentMessage items with phase 'commentary' are the model's narration, shown as thinking. */
  commentary: Set<string>;
  /** The item whose deltas are the visible answer, so `writing` is announced once per item. */
  writingItemId: string | null;
}

export function newItemPhases(): ItemPhases {
  return { commentary: new Set<string>(), writingItemId: null };
}

/** Everything a notification asks of the provider: emitting events, and the turn state machine. */
export interface NotificationHandlers {
  emit: (e: AgentEvent) => void;
  turnStarted: (turnId: string) => void;
  turnCompleted: (turnId: string, status: 'completed' | 'interrupted' | 'failed', error?: string) => void;
}

/** Maps one Codex notification onto `AgentEvent`s; `phases` is the only state it carries across calls. */
export function handleNotification(method: string, params: unknown, phases: ItemPhases, h: NotificationHandlers): void {
  const p = params as Record<string, unknown>;
  switch (method) {
    case 'turn/started': {
      const turn = p.turn as { id: string };
      h.turnStarted(turn.id);
      h.emit({ type: 'turn.started', turnId: turn.id });
      return;
    }
    case 'turn/completed': {
      const turn = p.turn as { id: string; status: 'completed' | 'interrupted' | 'failed'; error: { message: string } | null };
      h.turnCompleted(turn.id, turn.status, turn.error?.message);
      return;
    }
    case 'item/agentMessage/delta':
      if (phases.commentary.has(p.itemId as string)) {
        h.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: p.delta as string });
        return;
      }
      if (phases.writingItemId !== p.itemId) {
        phases.writingItemId = p.itemId as string;
        h.emit({ type: 'activity', activity: 'writing' });
      }
      h.emit({ type: 'message.delta', itemId: p.itemId as string, delta: p.delta as string });
      return;
    case 'item/reasoning/summaryTextDelta':
      h.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: p.delta as string });
      return;
    case 'item/reasoning/summaryPartAdded':
      if ((p.summaryIndex as number) > 0) h.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: '\n\n' });
      return;
    case 'item/started':
      itemStarted(p.item as Record<string, unknown>, phases, h.emit);
      return;
    case 'item/completed':
      itemCompleted(p.item as Record<string, unknown>, phases, h.emit);
      return;
    case 'error':
      h.emit({ type: 'status', status: 'error', message: JSON.stringify(params) });
      return;
    default:
      return;
  }
}

function itemStarted(item: Record<string, unknown>, phases: ItemPhases, emit: (e: AgentEvent) => void): void {
  if (item.type === 'reasoning') emit({ type: 'activity', activity: 'thinking' });
  if (item.type === 'agentMessage' && item.phase === 'commentary') {
    phases.commentary.add(item.id as string);
    emit({ type: 'activity', activity: 'thinking' });
  }
  if (item.type === 'dynamicToolCall') emit({ type: 'activity', activity: 'tool', detail: item.tool as string });
  if (item.type === 'webSearch') emit({ type: 'activity', activity: 'tool', detail: 'web_search' });
  if (item.type === 'commandExecution') emit({ type: 'activity', activity: 'tool', detail: 'shell' });
  if (item.type === 'mcpToolCall') emit({ type: 'activity', activity: 'tool', detail: `${item.server as string}/${item.tool as string}` });
  if (item.type === 'dynamicToolCall')
    emit({ type: 'tool.started', itemId: item.id as string, name: item.tool as string, args: item.arguments });
  if (item.type === 'commandExecution') emit({ type: 'tool.started', itemId: item.id as string, name: 'shell', args: item.command });
  if (item.type === 'mcpToolCall')
    emit({
      type: 'tool.started',
      itemId: item.id as string,
      name: `${item.server as string}/${item.tool as string}`,
      args: item.arguments,
    });
  if (item.type === 'webSearch')
    emit({ type: 'tool.started', itemId: item.id as string, name: 'web_search', args: { queries: webSearchQueries(item) } });
}

function itemCompleted(item: Record<string, unknown>, phases: ItemPhases, emit: (e: AgentEvent) => void): void {
  if (item.type === 'reasoning') {
    const text = ((item.summary as string[] | null) ?? []).join('\n\n');
    if (text) emit({ type: 'thinking.completed', itemId: item.id as string, text });
  }
  if (item.type === 'agentMessage' && (item.phase === 'commentary' || phases.commentary.has(item.id as string))) {
    phases.commentary.delete(item.id as string);
    emit({ type: 'thinking.completed', itemId: item.id as string, text: item.text as string });
  } else if (item.type === 'agentMessage') emit({ type: 'message.completed', itemId: item.id as string, text: item.text as string });
  if (item.type === 'dynamicToolCall') {
    const content = (item.contentItems as Array<{ type: string; text?: string }> | null) ?? [];
    emit({
      type: 'tool.completed',
      itemId: item.id as string,
      name: item.tool as string,
      success: item.success !== false,
      output: content.map((c) => c.text ?? '').join('\n'),
    });
  }
  if (item.type === 'commandExecution')
    emit({
      type: 'tool.completed',
      itemId: item.id as string,
      name: 'shell',
      success: item.exitCode === 0,
      output: (item.aggregatedOutput as string | null) ?? '',
    });
  if (item.type === 'mcpToolCall')
    emit({
      type: 'tool.completed',
      itemId: item.id as string,
      name: `${item.server as string}/${item.tool as string}`,
      success: !item.error,
      output: JSON.stringify(item.result ?? item.error ?? null),
    });
  if (item.type === 'webSearch')
    emit({
      type: 'tool.completed',
      itemId: item.id as string,
      name: 'web_search',
      success: true,
      output: (item.query as string | null) ?? webSearchQueries(item).join(' | '),
    });
}

export function webSearchQueries(item: Record<string, unknown>): string[] {
  const action = item.action as { queries?: string[] | null; query?: string | null } | undefined;
  if (action?.queries?.length) return action.queries;
  const q = action?.query ?? (item.query as string | null | undefined);
  return q ? [q] : [];
}

/** What answering a server-initiated request needs: the tools, the two brokers, the turn's signal. */
export interface ServerRequestDeps {
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  approvals: ApprovalBroker;
  /** Clarifying questions from the agent; without it `requestUserInput` is refused. */
  userInput?: UserInputBroker;
  /** Aborts when the turn is interrupted, times out, or ends. */
  signal?: AbortSignal;
  /** Handed the raw params before they are read, so the provider can log an unfamiliar shape. */
  onUserInputParams?(params: unknown): void;
}

export async function handleServerRequest(method: string, params: unknown, deps: ServerRequestDeps): Promise<unknown> {
  const p = params as Record<string, unknown>;
  switch (method) {
    case 'item/tool/call': {
      try {
        const result = await deps.callTool(p.tool as string, (p.arguments as Record<string, unknown>) ?? {}, deps.signal);
        const text = result.success ? JSON.stringify(result.content) : `Error: ${result.error}`;
        return { contentItems: [{ type: 'inputText', text: wrapToolOutput(text) }], success: result.success };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { contentItems: [{ type: 'inputText', text: wrapToolOutput(`Error: ${message}`) }], success: false };
      }
    }
    case 'item/commandExecution/requestApproval': {
      const { decision } = await deps.approvals.request(
        {
          kind: 'command',
          title: 'Codex wants to run a command',
          detail: `${(p.command as string | undefined) ?? ''}\n(cwd: ${(p.cwd as string | undefined) ?? ''})${p.reason ? `\n${p.reason as string}` : ''}`,
          options: [
            { id: 'accept', label: 'Allow' },
            { id: 'acceptForSession', label: 'Allow for session' },
            { id: 'decline', label: 'Deny' },
          ],
        },
        APPROVAL_TIMEOUT_MS,
      );
      return { decision: decision === 'timeout' ? 'decline' : decision };
    }
    case 'item/fileChange/requestApproval': {
      const { decision } = await deps.approvals.request(
        {
          kind: 'fileChange',
          title: 'Codex wants to change files',
          detail: JSON.stringify(p.changes ?? p, null, 2).slice(0, 2000),
          options: [
            { id: 'accept', label: 'Allow' },
            { id: 'decline', label: 'Deny' },
          ],
        },
        APPROVAL_TIMEOUT_MS,
      );
      return { decision: decision === 'timeout' ? 'decline' : decision };
    }
    case 'item/tool/requestUserInput': {
      const broker = deps.userInput;
      // An empty answer set reads as "the user said nothing"; an error tells the model the channel is closed.
      if (!broker) throw new JsonRpcError(-32601, 'requestUserInput is not supported by XPilot yet');
      deps.onUserInputParams?.(params);
      const questions = inputQuestions(p);
      if (questions.length === 0) throw new JsonRpcError(-32602, 'requestUserInput carried no questions');
      const answers = await broker.request({ questions }, USER_INPUT_TIMEOUT_MS);
      if (!answers) throw new JsonRpcError(-32001, 'The user did not answer the question');
      return { answers: questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? '' })) };
    }
    default:
      throw new Error(`Unsupported server request: ${method}`);
  }
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function questionOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const o of value.slice(0, OPTION_MAX)) {
    const label =
      typeof o === 'string'
        ? o
        : firstString((o as Record<string, unknown>)?.label, (o as Record<string, unknown>)?.value, (o as Record<string, unknown>)?.id);
    if (label) out.push(label);
  }
  return out;
}

/**
 * The app-server protocol ships no types with the CLI, and the field names vary between codex
 * versions, so read the questions defensively: anything that carries a prompt is one question,
 * and everything else about it is optional.
 */
export function inputQuestions(params: Record<string, unknown>): UserInputQuestion[] {
  const raw = Array.isArray(params.questions) ? params.questions : [];
  const out: UserInputQuestion[] = [];
  raw.slice(0, QUESTION_MAX).forEach((entry, i) => {
    const q = (entry !== null && typeof entry === 'object' ? entry : { prompt: entry }) as Record<string, unknown>;
    const prompt = firstString(q.prompt, q.question, q.text, q.label, q.title);
    if (!prompt) return;
    const options = questionOptions(q.options ?? q.choices);
    const secret = q.secret === true || q.sensitive === true || q.password === true;
    out.push({
      id: firstString(q.id, q.questionId, q.key) ?? `q${i + 1}`,
      prompt,
      ...(options.length > 0 ? { options } : {}),
      ...(secret ? { secret: true } : {}),
    });
  });
  return out;
}
