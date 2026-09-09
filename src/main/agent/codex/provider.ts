import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentEvent, UserInputQuestion } from '../../../shared/agent';
import type { PageContext } from '../../../shared/page';
import type { ToolResult, ToolSpec } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { UserInputBroker } from '../../user-input';
import { DEVELOPER_INSTRUCTIONS } from '../instructions';
import type { AgentProvider, ModelInfo, StartOptions } from '../provider';
import { JsonRpcError, JsonRpcStdio } from './jsonrpc';
import { CODEX_MISSING_MESSAGE, codexSpawnEnv, resolveCodexBinary } from './binary';
import { fence, fenceBlock, fenceLine, pageContentBlock } from '../fence';

export { fence } from '../fence';

/** The little we need of the detached watchdog child: enough for a test double. */
export interface DetachedProcess { pid?: number; unref(): void; kill(signal?: NodeJS.Signals): boolean }

export interface CodexProviderDeps {
  /** `signal` aborts when the turn is interrupted, times out, or ends: long tools should honour it. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  approvals: ApprovalBroker;
  /** Clarifying questions from the agent; without it `requestUserInput` is refused as before. */
  userInput?: UserInputBroker;
  spawn?: () => ChildProcessWithoutNullStreams;
  /** Spawns the orphan watchdog; defaults to a detached `/bin/sh`. */
  spawnDetached?: (command: string, args: string[], options: { detached: true; stdio: 'ignore' }) => DetachedProcess;
  /** Resolves the `codex` executable; defaults to the settings path plus auto-detection. */
  binary?: (explicit: string | null) => Promise<string | null>;
  clientVersion?: string;
  /** Silence that fails the turn; the warning comes at `turnIdleWarnMs` before it. */
  turnIdleTimeoutMs?: number;
  turnIdleWarnMs?: number;
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_IDLE_WARN_MS = 2 * 60 * 1000;
const WATCHDOG_SHELL = '/bin/sh';
const QUESTION_MAX = 24;
const OPTION_MAX = 32;
const STDERR_KEEP = 8 * 1024;
const STDERR_IN_MESSAGE = 400;
const SIGKILL_AFTER_MS = 2000;
const EXIT_WAIT_MS = 4000;

/** Caps on page-controlled fields, so one hostile post cannot crowd out the turn. */
const HANDLE_MAX = 64;
const URL_MAX = 512;
const TITLE_MAX = 200;
const TEXT_MAX = 4000;

export function wrapToolOutput(text: string): string {
  return `<tool-output untrusted source="x.com">\n${fence(text)}\n</tool-output>`;
}

/** Identity of a page context for "still the same view" dedupe across turns. */
export function contextKey(ctx: PageContext | null | undefined): string | null {
  if (!ctx) return null;
  return ctx.post ? `post:${ctx.post.id}` : `visible:${(ctx.visible ?? []).map((v) => v.id).join(',')}`;
}

/**
 * The page controls every field below, identity included, so all of them go inside the fence:
 * the only lines outside it are ours.
 */
export function buildTurnText(text: string, ctx: PageContext | null | undefined, lastKey: string | null): string {
  if (!ctx) return text;
  const unchanged = lastKey === contextKey(ctx);
  const p = ctx.post;
  if (p) {
    const author = p.authorName ? `@${fenceLine(p.authorHandle, HANDLE_MAX)} (${fenceLine(p.authorName, HANDLE_MAX)})` : `@${fenceLine(p.authorHandle, HANDLE_MAX)}`;
    const head = `${fenceLine(p.kind, HANDLE_MAX)} by ${author} at ${fenceLine(p.url, URL_MAX)}`;
    if (unchanged) return `Current page, unchanged since the last turn:\n${pageContentBlock([head])}\n\n${text}`;
    const lines = [head];
    if (p.articleTitle) lines.push(`Title: ${fenceLine(p.articleTitle, TITLE_MAX)}`);
    if (p.text) lines.push(fenceBlock(p.text, TEXT_MAX));
    if (p.articleBody) lines.push('', fenceBlock(p.articleBody, TEXT_MAX));
    return `Current page:\n${pageContentBlock(lines)}\n\n${text}`;
  }
  const visible = ctx.visible ?? [];
  if (visible.length === 0) return text;
  const view = `view: ${fenceLine(ctx.kind, HANDLE_MAX)} at ${fenceLine(ctx.url, URL_MAX)}`;
  if (unchanged) return `Current page, unchanged since the last turn:\n${pageContentBlock([view])}\n\n${text}`;
  const blocks = [pageContentBlock([view])];
  visible.forEach((v, i) => blocks.push(pageContentBlock([`${i + 1}. @${fenceLine(v.authorHandle, HANDLE_MAX)} — ${fenceLine(v.url, URL_MAX)}`, fenceBlock(v.text, TEXT_MAX)])));
  return `Current page, posts on screen top to bottom:\n${blocks.join('\n')}\n\n${text}`;
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex';
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rpc: JsonRpcStdio | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private running = false;
  private disconnected = false;
  private stopping = false;
  private stderrTail = '';
  /** Message from `proc.on('error')`, kept so the death that follows reports the useful cause. */
  private spawnError: string | null = null;
  private lastContextKey: string | null = null;
  private writingItemId: string | null = null;
  /** agentMessage items with phase 'commentary' are the model's narration, shown as thinking. */
  private readonly commentaryIds = new Set<string>();
  private lastActivity: string | null = null;
  /** Aborted when the turn is interrupted, times out, or ends; handed to every tool call of that turn. */
  private turnAbort: AbortController | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleWarned = false;
  /** Detached `sh` that kills the codex child if this process dies without stopping it. */
  private watchdog: DetachedProcess | null = null;
  private loggedInputParams = false;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: CodexProviderDeps) {}

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isRunning(): boolean { return this.running; }

  stderrSummary(limit = STDERR_IN_MESSAGE): string {
    return this.stderrTail.replace(/\s+/g, ' ').trim().slice(-limit);
  }

  async start(opts: StartOptions): Promise<{ threadId: string }> {
    this.disconnected = false;
    this.stopping = false;
    this.stderrTail = '';
    this.spawnError = null;
    this.emit({ type: 'status', status: 'starting' });
    const proc = this.deps.spawn ? this.deps.spawn() : await this.spawnCodex(opts);
    this.proc = proc;
    this.startWatchdog(proc.pid);
    // An unread stderr pipe fills at 64 KB and blocks the child forever, so always drain it.
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEEP); });
    proc.stderr.on('error', () => {});
    const rpc = new JsonRpcStdio(proc.stdin, proc.stdout);
    this.rpc = rpc;
    // 'exit' and 'close' both fire for a normal death, and a spawn failure ('error', e.g. no
    // `codex` on PATH) reports only 'error' + 'close' - so handle all three, exactly once.
    let died = false;
    const die = (code: number | null) => {
      if (died) return;
      died = true;
      const tail = this.stderrSummary();
      const message = this.spawnError ?? `codex exited (${code})${tail ? `: ${tail}` : ''}`;
      rpc.rejectAll(new Error(message));
      this.disconnected = true;
      this.finishTurn('failed', message);
      if (!this.stopping) {
        console.error(`[xpilot] ${message}`);
        this.deps.approvals.cancelAll('cancel');
        this.deps.userInput?.cancelAll();
      }
      this.emit({ type: 'status', status: 'disconnected', message });
    };
    proc.on('error', (err) => {
      this.spawnError = `Could not start codex: ${err.message}. Install Codex CLI and run \`codex login\`.`;
      this.emit({ type: 'status', status: 'error', message: this.spawnError });
      rpc.rejectAll(err); // so a pending initialize (and therefore start()) settles instead of hanging
    });
    proc.stdin.on('error', () => {});
    proc.on('exit', (code) => die(code));
    proc.on('close', (code) => die(code));
    rpc.onNotification((m, p) => this.onNotification(m, p));
    rpc.onRequest((m, p) => this.onServerRequest(m, p));

    await rpc.request('initialize', {
      clientInfo: { name: 'x-pilot', title: 'XPilot', version: this.deps.clientVersion ?? '0.0.0-dev' },
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
      } catch (err) {
        console.warn(`[xpilot] thread/resume ${opts.threadId} failed, starting a new thread: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
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

  private async spawnCodex(opts: StartOptions): Promise<ChildProcessWithoutNullStreams> {
    const binary = await this.resolveBinary(opts);
    return nodeSpawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: await codexSpawnEnv(binary) });
  }

  private async resolveBinary(opts: StartOptions): Promise<string> {
    const explicit = opts.settings.binPath ?? null;
    const found = await (this.deps.binary ? this.deps.binary(explicit) : resolveCodexBinary(explicit));
    if (found) return found;
    this.emit({ type: 'status', status: 'error', message: CODEX_MISSING_MESSAGE });
    throw new Error(CODEX_MISSING_MESSAGE);
  }

  async send(text: string, pageContext?: PageContext | null): Promise<void> {
    if (!this.rpc || !this.threadId) throw new Error('provider not started');
    const full = buildTurnText(text, pageContext, this.lastContextKey);
    this.lastContextKey = contextKey(pageContext) ?? this.lastContextKey;
    this.emit({ type: 'user.message', text });
    this.running = true;
    this.turnAbort = new AbortController();
    this.emit({ type: 'status', status: 'running' });
    this.touchIdle();
    try {
      await this.rpc.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: full, text_elements: [] }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.finishTurn('failed', message, '');
      throw err;
    }
  }

  async interrupt(): Promise<void> {
    const controller = this.turnAbort;
    try {
      if (!this.rpc || !this.threadId || !this.turnId) return;
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
    } finally {
      // Codex stops generating; the tool call already in flight only stops if we abort it.
      controller?.abort(new Error('The turn was interrupted'));
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.rpc) return [];
    const res = await this.rpc.request<{ data: Array<{ id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: Array<{ reasoningEffort: string }> }> }>('model/list', {});
    return res.data.map((m) => ({ id: m.id, displayName: m.displayName, isDefault: m.isDefault, reasoningEfforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) }));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearIdle();
    this.abortTurn(new Error('The agent was stopped'));
    const proc = this.proc;
    if (proc && proc.exitCode === null) {
      // Wait for the process to actually exit so a following thread/resume never races its rollout writes.
      const exited = new Promise<void>((resolve) => {
        const kill = setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, SIGKILL_AFTER_MS);
        const giveUp = setTimeout(() => { clearTimeout(kill); resolve(); }, EXIT_WAIT_MS);
        proc.once('exit', () => { clearTimeout(kill); clearTimeout(giveUp); resolve(); });
      });
      proc.kill();
      await exited;
    }
    this.stopWatchdog();
    this.proc = null;
    this.rpc = null;
  }

  /**
   * A SIGKILL of Electron leaves `codex app-server` running: it does not exit when its stdin
   * closes. This detached shell outlives us and reaps it. `stop()` kills it on the way out.
   */
  private startWatchdog(childPid: number | undefined): void {
    if (!childPid || process.platform === 'win32') return;
    const spawnDetached = this.deps.spawnDetached ?? ((command, args, options) => nodeSpawn(command, args, options));
    try {
      const dog = spawnDetached(WATCHDOG_SHELL, watchdogArgs(process.pid, childPid), { detached: true, stdio: 'ignore' });
      dog.unref();
      this.watchdog = dog;
    } catch (err) {
      console.warn(`[xpilot] could not start the codex watchdog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private stopWatchdog(): void {
    const dog = this.watchdog;
    this.watchdog = null;
    try { dog?.kill('SIGTERM'); } catch { /* it may have exited on its own already */ }
  }

  private abortTurn(reason: Error): void {
    const controller = this.turnAbort;
    this.turnAbort = null;
    controller?.abort(reason);
  }

  private idleLimits(): { warn: number; timeout: number } {
    const timeout = this.deps.turnIdleTimeoutMs ?? TURN_IDLE_TIMEOUT_MS;
    const warn = Math.min(this.deps.turnIdleWarnMs ?? TURN_IDLE_WARN_MS, timeout);
    return { warn, timeout };
  }

  /** Anything from the server counts as progress; the countdown starts again from here. */
  private touchIdle(): void {
    if (!this.running) return;
    this.idleWarned = false;
    this.armIdle();
  }

  private armIdle(): void {
    this.clearIdle();
    const { warn, timeout } = this.idleLimits();
    const timer = setTimeout(() => this.onIdle(), this.idleWarned ? Math.max(timeout - warn, 0) : warn);
    timer.unref?.();
    this.idleTimer = timer;
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private onIdle(): void {
    if (!this.running) return;
    if (!this.idleWarned) {
      this.idleWarned = true;
      this.emit({ type: 'activity', activity: 'waiting' });
      this.armIdle();
      return;
    }
    // The process is left alone on purpose: it may still be alive and useful, and killing it
    // would throw away the thread. The user decides with Stop / Reconnect.
    const { timeout } = this.idleLimits();
    const message = `Codex sent nothing for ${Math.round(timeout / 1000)}s, so XPilot stopped waiting for this turn.`;
    this.abortTurn(new Error(message));
    this.finishTurn('failed', message);
    this.emit({ type: 'status', status: 'error', message: `${message} Press Stop, then Reconnect, if the agent stays stuck.` });
  }

  private emit(e: AgentEvent): void {
    if (e.type === 'activity') {
      const key = `${e.activity}:${e.detail ?? ''}`;
      if (key === this.lastActivity) return; // consecutive duplicates carry no information
      this.lastActivity = key;
    } else if (e.type === 'turn.started' || e.type === 'turn.completed') this.lastActivity = null;
    for (const cb of this.listeners) cb(e);
  }

  /** Idempotent: no-ops unless a turn is actually running, so a racing exit/notification/send-catch cannot double-fire. */
  private finishTurn(status: 'completed' | 'interrupted' | 'failed', error?: string, turnId?: string): void {
    if (!this.running) return;
    this.running = false;
    this.clearIdle();
    this.abortTurn(new Error(`The turn ${status}`));
    this.emit({ type: 'turn.completed', turnId: turnId ?? this.turnId ?? '', status, error });
    if (!this.disconnected) this.emit({ type: 'status', status: 'ready' });
  }

  private onNotification(method: string, params: unknown): void {
    this.touchIdle();
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
        if (this.commentaryIds.has(p.itemId as string)) { this.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: p.delta as string }); return; }
        if (this.writingItemId !== p.itemId) { this.writingItemId = p.itemId as string; this.emit({ type: 'activity', activity: 'writing' }); }
        this.emit({ type: 'message.delta', itemId: p.itemId as string, delta: p.delta as string });
        return;
      case 'item/reasoning/summaryTextDelta':
        this.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: p.delta as string });
        return;
      case 'item/reasoning/summaryPartAdded':
        if ((p.summaryIndex as number) > 0) this.emit({ type: 'thinking.delta', itemId: p.itemId as string, delta: '\n\n' });
        return;
      case 'item/started': {
        const item = p.item as Record<string, unknown>;
        if (item.type === 'reasoning') this.emit({ type: 'activity', activity: 'thinking' });
        if (item.type === 'agentMessage' && item.phase === 'commentary') { this.commentaryIds.add(item.id as string); this.emit({ type: 'activity', activity: 'thinking' }); }
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
        if (item.type === 'reasoning') {
          const text = ((item.summary as string[] | null) ?? []).join('\n\n');
          if (text) this.emit({ type: 'thinking.completed', itemId: item.id as string, text });
        }
        if (item.type === 'agentMessage' && (item.phase === 'commentary' || this.commentaryIds.has(item.id as string))) {
          this.commentaryIds.delete(item.id as string);
          this.emit({ type: 'thinking.completed', itemId: item.id as string, text: item.text as string });
        } else if (item.type === 'agentMessage') this.emit({ type: 'message.completed', itemId: item.id as string, text: item.text as string });
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
    this.touchIdle();
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'item/tool/call': {
        try {
          const result = await this.deps.callTool(p.tool as string, (p.arguments as Record<string, unknown>) ?? {}, this.turnAbort?.signal);
          const text = result.success ? JSON.stringify(result.content) : `Error: ${result.error}`;
          return { contentItems: [{ type: 'inputText', text: wrapToolOutput(text) }], success: result.success };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { contentItems: [{ type: 'inputText', text: wrapToolOutput(`Error: ${message}`) }], success: false };
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
      case 'item/tool/requestUserInput': {
        const broker = this.deps.userInput;
        // An empty answer set reads as "the user said nothing"; an error tells the model the channel is closed.
        if (!broker) throw new JsonRpcError(-32601, 'requestUserInput is not supported by XPilot yet');
        if (!this.loggedInputParams && process.env.NODE_ENV !== 'production') {
          this.loggedInputParams = true;
          console.log(`[xpilot] requestUserInput params: ${JSON.stringify(params).slice(0, 2000)}`);
        }
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
}

/**
 * A detached `sh` that polls both pids: while Electron and the codex child are both alive it
 * sleeps; once Electron is gone - a SIGKILL leaves codex running, since it does not exit when
 * its stdin closes - it sends the child SIGTERM. The pids are arguments, never interpolated
 * into the script.
 */
export function watchdogArgs(parentPid: number, childPid: number): string[] {
  return ['-c', 'while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do sleep 2; done; kill -TERM "$2" 2>/dev/null', 'sh', String(parentPid), String(childPid)];
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function questionOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const o of value.slice(0, OPTION_MAX)) {
    const label = typeof o === 'string' ? o : firstString((o as Record<string, unknown>)?.label, (o as Record<string, unknown>)?.value, (o as Record<string, unknown>)?.id);
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

function webSearchQueries(item: Record<string, unknown>): string[] {
  const action = item.action as { queries?: string[] | null; query?: string | null } | undefined;
  if (action?.queries?.length) return action.queries;
  const q = action?.query ?? (item.query as string | null | undefined);
  return q ? [q] : [];
}
