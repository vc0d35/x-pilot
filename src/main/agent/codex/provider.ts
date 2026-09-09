import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentEvent } from '../../../shared/agent';
import type { PageContext } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import type { ToolResult } from '../../../shared/tools';
import type { ApprovalBroker } from '../../approvals';
import type { UserInputBroker } from '../../user-input';
import { DEVELOPER_INSTRUCTIONS } from '../instructions';
import type { AgentProvider, ModelInfo, StartOptions } from '../provider';
import { JsonRpcStdio } from './jsonrpc';
import { CODEX_MISSING_MESSAGE, codexSpawnEnv, resolveCodexBinary } from './binary';
import { handleNotification, handleServerRequest, newItemPhases, type ItemPhases } from './events';
import { buildTurnText } from './turn-text';

export { fence } from '../fence';
export { contextKey } from '../../../shared/page-context';
export { buildTurnText } from './turn-text';
export { inputQuestions, wrapToolOutput } from './events';

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

const TURN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_IDLE_WARN_MS = 2 * 60 * 1000;
const WATCHDOG_SHELL = '/bin/sh';
const STDERR_KEEP = 8 * 1024;
const STDERR_IN_MESSAGE = 400;
const SIGKILL_AFTER_MS = 2000;
const EXIT_WAIT_MS = 4000;

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
  private readonly phases: ItemPhases = newItemPhases();
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
    handleNotification(method, params, this.phases, {
      emit: (e) => this.emit(e),
      turnStarted: (turnId) => { this.turnId = turnId; },
      turnCompleted: (turnId, status, error) => this.finishTurn(status, error, turnId),
    });
  }

  private async onServerRequest(method: string, params: unknown): Promise<unknown> {
    this.touchIdle();
    return handleServerRequest(method, params, {
      callTool: (name, args, signal) => this.deps.callTool(name, args, signal),
      approvals: this.deps.approvals,
      userInput: this.deps.userInput,
      signal: this.turnAbort?.signal,
      onUserInputParams: (p) => this.logInputParamsOnce(p),
    });
  }

  private logInputParamsOnce(params: unknown): void {
    if (this.loggedInputParams || process.env.NODE_ENV === 'production') return;
    this.loggedInputParams = true;
    console.log(`[xpilot] requestUserInput params: ${JSON.stringify(params).slice(0, 2000)}`);
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
