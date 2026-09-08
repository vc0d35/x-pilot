import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentEvent } from '../../../shared/agent';
import type { PageContext } from '../../../shared/page';
import type { ToolResult, ToolSpec } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import { DEVELOPER_INSTRUCTIONS } from '../instructions';
import type { AgentProvider, ModelInfo, StartOptions } from '../provider';
import { JsonRpcStdio } from './jsonrpc';

export interface CodexProviderDeps {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  approvals: ApprovalBroker;
  spawn?: () => ChildProcessWithoutNullStreams;
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export function buildTurnText(text: string, ctx: PageContext | null | undefined, lastPostId: string | null): string {
  if (!ctx) return text;
  const p = ctx.post;
  if (lastPostId === p.id) return `Current page: still the ${p.kind} by @${p.authorHandle} at ${p.url}\n\n${text}`;
  const lines = [`Current page: ${p.kind} by @${p.authorHandle} at ${p.url}`, '<page-content untrusted>'];
  if (p.articleTitle) lines.push(`Title: ${p.articleTitle}`);
  lines.push(p.text);
  if (p.articleBody) lines.push('', p.articleBody.slice(0, 4000));
  lines.push('</page-content>');
  return `${lines.join('\n')}\n\n${text}`;
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex';
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rpc: JsonRpcStdio | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private running = false;
  private disconnected = false;
  private lastPostId: string | null = null;
  private writingItemId: string | null = null;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: CodexProviderDeps) {}

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isRunning(): boolean { return this.running; }

  async start(opts: StartOptions): Promise<{ threadId: string }> {
    this.disconnected = false;
    this.emit({ type: 'status', status: 'starting' });
    const proc = this.deps.spawn ? this.deps.spawn() : nodeSpawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    const rpc = new JsonRpcStdio(proc.stdin, proc.stdout);
    this.rpc = rpc;
    // 'exit' and 'close' both fire for a normal death, and a spawn failure ('error', e.g. no
    // `codex` on PATH) reports only 'error' + 'close' - so handle all three, exactly once.
    let died = false;
    const die = (code: number | null) => {
      if (died) return;
      died = true;
      rpc.rejectAll(new Error(`codex exited with code ${code}`));
      this.disconnected = true;
      this.finishTurn('failed', `codex exited (${code})`);
      this.deps.approvals.cancelAll('cancel');
      this.emit({ type: 'status', status: 'disconnected', message: `codex exited (${code})` });
    };
    proc.on('error', (err) => {
      this.emit({ type: 'status', status: 'error', message: `Could not start codex: ${err.message}. Install Codex CLI and run \`codex login\`.` });
      rpc.rejectAll(err); // so a pending initialize (and therefore start()) settles instead of hanging
    });
    proc.stdin.on('error', () => {});
    proc.on('exit', (code) => die(code));
    proc.on('close', (code) => die(code));
    rpc.onNotification((m, p) => this.onNotification(m, p));
    rpc.onRequest((m, p) => this.onServerRequest(m, p));

    await rpc.request('initialize', {
      clientInfo: { name: 'x-pilot', title: 'X Pilot', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify('initialized');

    const dynamicTools = opts.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, inputSchema: t.inputSchema }));
    const common = {
      cwd: opts.workspaceDir,
      model: opts.settings.model,
      approvalPolicy: opts.settings.approvalPolicy,
      sandbox: opts.settings.sandbox,
      developerInstructions: DEVELOPER_INSTRUCTIONS,
      config: {
        ...(opts.settings.reasoningEffort ? { model_reasoning_effort: opts.settings.reasoningEffort } : {}),
        web_search: opts.settings.webSearch,
      },
    };
    let res: { thread: { id: string } };
    if (opts.threadId) {
      try {
        res = await rpc.request('thread/resume', { threadId: opts.threadId, ...common });
      } catch {
        res = await rpc.request('thread/start', { ...common, dynamicTools });
      }
    } else {
      res = await rpc.request('thread/start', { ...common, dynamicTools });
    }
    this.threadId = res.thread.id;
    this.emit({ type: 'thread', threadId: this.threadId });
    this.emit({ type: 'status', status: 'ready' });
    return { threadId: this.threadId };
  }

  async send(text: string, pageContext?: PageContext | null): Promise<void> {
    if (!this.rpc || !this.threadId) throw new Error('provider not started');
    const full = buildTurnText(text, pageContext, this.lastPostId);
    this.lastPostId = pageContext?.post.id ?? this.lastPostId;
    this.emit({ type: 'user.message', text });
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    try {
      await this.rpc.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: full, text_elements: [] }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.finishTurn('failed', message, '');
      throw err;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.rpc || !this.threadId || !this.turnId) return;
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.rpc) return [];
    const res = await this.rpc.request<{ data: Array<{ id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }> }>('model/list', {});
    return res.data.map((m) => ({ id: m.id, displayName: m.displayName, isDefault: m.isDefault, reasoningEfforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) }));
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.proc = null;
    this.rpc = null;
  }

  private emit(e: AgentEvent): void { for (const cb of this.listeners) cb(e); }

  /** Idempotent: no-ops unless a turn is actually running, so a racing exit/notification/send-catch cannot double-fire. */
  private finishTurn(status: 'completed' | 'interrupted' | 'failed', error?: string, turnId?: string): void {
    if (!this.running) return;
    this.running = false;
    this.emit({ type: 'turn.completed', turnId: turnId ?? this.turnId ?? '', status, error });
    if (!this.disconnected) this.emit({ type: 'status', status: 'ready' });
  }

  private onNotification(method: string, params: unknown): void {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'turn/started': {
        const turn = p.turn as { id: string };
        this.turnId = turn.id;
        this.emit({ type: 'turn.started', turnId: turn.id });
        return;
      }
      case 'turn/completed': {
        const turn = p.turn as { id: string; status: 'completed' | 'interrupted' | 'failed'; error: { message: string } | null };
        this.finishTurn(turn.status, turn.error?.message, turn.id);
        return;
      }
      case 'item/agentMessage/delta':
        if (this.writingItemId !== p.itemId) { this.writingItemId = p.itemId as string; this.emit({ type: 'activity', activity: 'writing' }); }
        this.emit({ type: 'message.delta', itemId: p.itemId as string, delta: p.delta as string });
        return;
      case 'item/started': {
        const item = p.item as Record<string, unknown>;
        if (item.type === 'reasoning') this.emit({ type: 'activity', activity: 'thinking' });
        if (item.type === 'dynamicToolCall') this.emit({ type: 'activity', activity: 'tool', detail: item.tool as string });
        if (item.type === 'webSearch') this.emit({ type: 'activity', activity: 'tool', detail: 'web_search' });
        if (item.type === 'commandExecution') this.emit({ type: 'activity', activity: 'tool', detail: 'shell' });
        if (item.type === 'mcpToolCall') this.emit({ type: 'activity', activity: 'tool', detail: `${item.server}/${item.tool}` });
        if (item.type === 'dynamicToolCall') this.emit({ type: 'tool.started', itemId: item.id as string, name: item.tool as string, args: item.arguments });
        if (item.type === 'commandExecution') this.emit({ type: 'tool.started', itemId: item.id as string, name: 'shell', args: item.command });
        if (item.type === 'mcpToolCall') this.emit({ type: 'tool.started', itemId: item.id as string, name: `${item.server}/${item.tool}`, args: item.arguments });
        if (item.type === 'webSearch') this.emit({ type: 'tool.started', itemId: item.id as string, name: 'web_search', args: { queries: webSearchQueries(item) } });
        return;
      }
      case 'item/completed': {
        const item = p.item as Record<string, unknown>;
        if (item.type === 'agentMessage') this.emit({ type: 'message.completed', itemId: item.id as string, text: item.text as string });
        if (item.type === 'dynamicToolCall') {
          const content = (item.contentItems as Array<{ type: string; text?: string }> | null) ?? [];
          this.emit({ type: 'tool.completed', itemId: item.id as string, name: item.tool as string, success: item.success !== false, output: content.map((c) => c.text ?? '').join('\n') });
        }
        if (item.type === 'commandExecution') this.emit({ type: 'tool.completed', itemId: item.id as string, name: 'shell', success: item.exitCode === 0, output: (item.aggregatedOutput as string | null) ?? '' });
        if (item.type === 'mcpToolCall') this.emit({ type: 'tool.completed', itemId: item.id as string, name: `${item.server}/${item.tool}`, success: !item.error, output: JSON.stringify(item.result ?? item.error ?? null) });
        if (item.type === 'webSearch') this.emit({ type: 'tool.completed', itemId: item.id as string, name: 'web_search', success: true, output: (item.query as string | null) ?? webSearchQueries(item).join(' | ') });
        return;
      }
      case 'error':
        this.emit({ type: 'status', status: 'error', message: JSON.stringify(params) });
        return;
      default:
        return;
    }
  }

  private async onServerRequest(method: string, params: unknown): Promise<unknown> {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'item/tool/call': {
        try {
          const result = await this.deps.callTool(p.tool as string, (p.arguments as Record<string, unknown>) ?? {});
          const text = result.success ? JSON.stringify(result.content) : `Error: ${result.error}`;
          return { contentItems: [{ type: 'inputText', text }], success: result.success };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { contentItems: [{ type: 'inputText', text: `Error: ${message}` }], success: false };
        }
      }
      case 'item/commandExecution/requestApproval': {
        const decision = await this.deps.approvals.request({
          kind: 'command',
          title: 'Codex wants to run a command',
          detail: `${p.command ?? ''}\n(cwd: ${p.cwd ?? ''})${p.reason ? `\n${p.reason}` : ''}`,
          options: [{ id: 'accept', label: 'Allow' }, { id: 'acceptForSession', label: 'Allow for session' }, { id: 'decline', label: 'Deny' }],
        }, APPROVAL_TIMEOUT_MS);
        return { decision: decision === 'timeout' ? 'decline' : decision };
      }
      case 'item/fileChange/requestApproval': {
        const decision = await this.deps.approvals.request({
          kind: 'fileChange',
          title: 'Codex wants to change files',
          detail: JSON.stringify(p.changes ?? p, null, 2).slice(0, 2000),
          options: [{ id: 'accept', label: 'Allow' }, { id: 'decline', label: 'Deny' }],
        }, APPROVAL_TIMEOUT_MS);
        return { decision: decision === 'timeout' ? 'decline' : decision };
      }
      case 'item/tool/requestUserInput':
        return { answers: {} };
      default:
        throw new Error(`Unsupported server request: ${method}`);
    }
  }
}

/** Queries of a Codex `webSearch` item: `action.queries` when present, else the single `query`. */
function webSearchQueries(item: Record<string, unknown>): string[] {
  const action = item.action as { queries?: string[] | null; query?: string | null } | undefined;
  if (action?.queries?.length) return action.queries;
  const q = action?.query ?? (item.query as string | null | undefined);
  return q ? [q] : [];
}
