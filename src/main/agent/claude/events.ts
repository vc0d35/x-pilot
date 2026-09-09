import type { AgentEvent } from '../../../shared/agent';

/** The `mcp__<server>__` prefix the SDK gives our in-process tools. */
export const TOOL_PREFIX = 'mcp__xpilot__';

/** Claude's own web search, mapped to the same row Codex's web search gets. */
const WEB_SEARCH = 'WebSearch';
const WEB_SEARCH_NAME = 'web_search';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One in-flight `tool_use` block: what the model called, and whether we have already reported it. */
interface PendingCall {
  id: string;
  /** The name as the SDK sends it, `mcp__xpilot__x_read_post` included. */
  rawName: string;
  /** The name the sidebar shows: the prefix stripped, or `web_search`. */
  name: string;
  json: string;
  /** A handler of ours took this block, so a second parallel call does not take it too. */
  claimed: boolean;
  completed: boolean;
}

interface Block {
  kind: 'text' | 'thinking' | 'tool_use';
  itemId: string;
  text: string;
}

export interface ClaudeStreamHandlers {
  emit(e: AgentEvent): void;
  /** The session id from the `init` message; it is the thread id we resume. */
  session(sessionId: string): void;
  /** The `result` message: the turn is over, one way or the other. */
  result(status: 'completed' | 'failed', error?: string): void;
}

/** The display name for a tool the model called. */
export function displayName(rawName: string): string {
  if (rawName === WEB_SEARCH) return WEB_SEARCH_NAME;
  return rawName.startsWith(TOOL_PREFIX) ? rawName.slice(TOOL_PREFIX.length) : rawName;
}

function toolArgs(rawName: string, input: unknown): unknown {
  if (rawName !== WEB_SEARCH) return input;
  const query = isObj(input) ? str(input.query) : '';
  return { queries: query ? [query] : [] };
}

/**
 * Turns the SDK's message stream into `AgentEvent`s. It is a class because the mapping is
 * stateful: content blocks arrive as deltas addressed by index, tool calls are answered a message
 * later, and our own tools report their own completion from the handler that ran them.
 *
 * Messages are read defensively (the SDK's union is large and versioned), so anything unfamiliar
 * is ignored rather than crashing a turn.
 */
export class ClaudeStream {
  private blocks = new Map<number, Block>();
  private pending: PendingCall[] = [];
  private messageSeq = 0;
  private writingItemId: string | null = null;

  constructor(private readonly h: ClaudeStreamHandlers) {}

  handle(message: unknown): void {
    if (!isObj(message)) return;
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init' && str(message.session_id)) this.h.session(str(message.session_id));
        return;
      case 'stream_event':
        this.streamEvent(message.event);
        return;
      case 'user':
        this.toolResults(message.message);
        return;
      case 'result':
        this.finish(message);
        return;
      default:
        return;
    }
  }

  /**
   * Our own tool ran. The SDK calls the handler before the `tool_use` block closes, so the call is
   * paired with the block the model opened for it, by name and then by arrival order.
   */
  ownToolStarted(name: string, args: unknown): string {
    const call = this.pending.find((c) => !c.claimed && !c.completed && c.name === name);
    if (call) {
      call.claimed = true;
      return call.id;
    }
    // No block seen for it: keep the pairing honest with a call of our own so the result still lands.
    const id = `tool-${name}-${this.pending.length}`;
    this.pending.push({ id, rawName: `${TOOL_PREFIX}${name}`, name, json: JSON.stringify(args ?? {}), claimed: true, completed: false });
    return id;
  }

  ownToolCompleted(itemId: string): void {
    const call = this.pending.find((c) => c.id === itemId);
    if (call) call.completed = true;
  }

  private streamEvent(event: unknown): void {
    if (!isObj(event)) return;
    const index = typeof event.index === 'number' ? event.index : -1;
    switch (event.type) {
      case 'message_start':
        this.messageSeq++;
        this.blocks.clear();
        return;
      case 'content_block_start':
        this.blockStart(index, event.content_block);
        return;
      case 'content_block_delta':
        this.blockDelta(index, event.delta);
        return;
      case 'content_block_stop':
        this.blockStop(index);
        return;
      default:
        return;
    }
  }

  private blockStart(index: number, raw: unknown): void {
    if (!isObj(raw)) return;
    const kind = raw.type;
    if (kind === 'thinking') {
      this.blocks.set(index, { kind: 'thinking', itemId: `think-${this.messageSeq}-${index}`, text: '' });
      this.h.emit({ type: 'activity', activity: 'thinking' });
      return;
    }
    if (kind === 'text') {
      const itemId = `msg-${this.messageSeq}-${index}`;
      this.blocks.set(index, { kind: 'text', itemId, text: '' });
      if (this.writingItemId !== itemId) {
        this.writingItemId = itemId;
        this.h.emit({ type: 'activity', activity: 'writing' });
      }
      return;
    }
    if (kind === 'tool_use') {
      const id = str(raw.id) || `tool-${this.messageSeq}-${index}`;
      const rawName = str(raw.name);
      const name = displayName(rawName);
      this.blocks.set(index, { kind: 'tool_use', itemId: id, text: '' });
      this.pending.push({ id, rawName, name, json: '', claimed: false, completed: false });
      this.h.emit({ type: 'activity', activity: 'tool', detail: name });
    }
  }

  private blockDelta(index: number, raw: unknown): void {
    const block = this.blocks.get(index);
    if (!block || !isObj(raw)) return;
    if (raw.type === 'text_delta' && block.kind === 'text') {
      const delta = str(raw.text);
      block.text += delta;
      this.h.emit({ type: 'message.delta', itemId: block.itemId, delta });
      return;
    }
    if (raw.type === 'thinking_delta' && block.kind === 'thinking') {
      const delta = str(raw.thinking);
      block.text += delta;
      if (delta) this.h.emit({ type: 'thinking.delta', itemId: block.itemId, delta });
      return;
    }
    if (raw.type === 'input_json_delta' && block.kind === 'tool_use') {
      const call = this.pending.find((c) => c.id === block.itemId);
      if (call) call.json += str(raw.partial_json);
    }
  }

  private blockStop(index: number): void {
    const block = this.blocks.get(index);
    if (!block) return;
    this.blocks.delete(index);
    if (block.kind === 'text') {
      if (block.text) this.h.emit({ type: 'message.completed', itemId: block.itemId, text: block.text });
      return;
    }
    if (block.kind === 'thinking') {
      if (block.text) this.h.emit({ type: 'thinking.completed', itemId: block.itemId, text: block.text });
      return;
    }
    // Our own tools report themselves from the handler that ran them, with the parsed arguments;
    // a built-in tool has nobody else to report it, so its row is opened here.
    const call = this.pending.find((c) => c.id === block.itemId);
    if (!call || call.rawName.startsWith(TOOL_PREFIX)) return;
    this.h.emit({ type: 'tool.started', itemId: call.id, name: call.name, args: toolArgs(call.rawName, parseJson(call.json)) });
  }

  /** Tool results come back as a user message; only calls nobody has reported yet are completed here. */
  private toolResults(message: unknown): void {
    if (!isObj(message) || !Array.isArray(message.content)) return;
    for (const entry of message.content) {
      if (!isObj(entry) || entry.type !== 'tool_result') continue;
      const id = str(entry.tool_use_id);
      const call = id ? this.pending.find((c) => c.id === id) : this.pending.find((c) => !c.completed);
      if (!call || call.completed) continue;
      call.completed = true;
      this.h.emit({
        type: 'tool.completed',
        itemId: call.id,
        name: call.name,
        success: entry.is_error !== true,
        output: resultText(entry.content),
      });
    }
  }

  private finish(message: Record<string, unknown>): void {
    this.pending = [];
    this.blocks.clear();
    this.writingItemId = null;
    const failed = message.is_error === true || message.subtype !== 'success';
    if (!failed) {
      this.h.result('completed');
      return;
    }
    const errors = Array.isArray(message.errors) ? message.errors.map(str).filter(Boolean) : [];
    const text = errors.join('\n') || str(message.result) || `Claude ended the turn with ${str(message.subtype) || 'an error'}`;
    this.h.result('failed', text);
  }
}

function parseJson(json: string): unknown {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** A tool result's content: a string, or MCP content blocks. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === undefined ? '' : JSON.stringify(content);
  return content
    .map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .filter(Boolean)
    .join('\n');
}
