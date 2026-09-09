import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '../../../shared/agent';
import type { PageContext } from '../../../shared/page';
import { contextKey } from '../../../shared/page-context';
import type { Settings } from '../../../shared/settings';
import type { ToolResult, ToolSpec } from '../../../shared/tools';
import { DEVELOPER_INSTRUCTIONS } from '../instructions';
import type { AgentProvider, ModelInfo, ProviderKind, StartOptions } from '../provider';
import { buildTurnText } from '../codex/turn-text';
import { claudeMissingMessage, claudeSpawnEnv, resolveClaudeBinary } from './binary';
import { ClaudeStream } from './events';
import { CLAUDE_MODELS } from './models';
import type { ClaudeQueryHandle, ClaudeTool, RunQuery } from './query';
import { toolResultText, toolShape } from './tools';

const LIFECYCLE_EVENTS = new Set([
  'status',
  'turn.started',
  'turn.completed',
  'approval.requested',
  'approval.resolved',
  'input.requested',
  'input.resolved',
  'thread',
  'user.message',
]);
const TURN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_IDLE_WARN_MS = 2 * 60 * 1000;
const STDERR_KEEP = 8 * 1024;
const STDERR_IN_MESSAGE = 400;
/** The recorded session is not on disk any more: start a new one rather than failing every turn. */
const MISSING_SESSION = /No conversation found with session ID/i;

export interface ClaudeProviderDeps {
  /** `signal` aborts when the turn is interrupted, times out, or ends: long tools should honour it. */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  /** Runs one turn; `runSdkQuery` in production, scripted messages in tests. */
  runQuery: RunQuery;
  /** Resolves the `claude` executable; defaults to the settings path plus auto-detection. */
  binary?: (explicit: string | null) => Promise<string | null>;
  /** The environment the CLI is spawned with; defaults to ours plus the binary's directory on PATH. */
  env?: (binary: string) => Promise<NodeJS.ProcessEnv>;
  /** Silence that fails the turn; the warning comes at `turnIdleWarnMs` before it. */
  turnIdleTimeoutMs?: number;
  turnIdleWarnMs?: number;
}

/**
 * Drives Claude Code through the Agent SDK, which spawns the user's own `claude` binary once per
 * turn. Unlike Codex there is no long-lived process to hold: `start()` only resolves the binary and
 * decides which session the next turn continues.
 */
export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude';
  readonly kind: ProviderKind = 'claude';
  /** Claude reads the tool list on every turn, so a changed tool set can resume the same session. */
  readonly capabilities = { toolsFrozenPerThread: false };
  private threadId: string | null = null;
  /** Whether the CLI has written this session, so the next turn resumes it instead of naming it. */
  private sessionEstablished = false;
  private binaryPath: string | null = null;
  private tools: ToolSpec[] = [];
  private settings: Settings['agent']['claude'] | null = null;
  private workspaceDir = '';
  private running = false;
  private stopping = false;
  private interrupted = false;
  private turnId: string | null = null;
  private turnAbort: AbortController | null = null;
  private query: ClaudeQueryHandle | null = null;
  private outcome: { status: 'completed' | 'failed'; error?: string } | null = null;
  private stream: ClaudeStream;
  private stderrTail = '';
  private lastContextKey: string | null = null;
  private lastActivity: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleWarned = false;
  private pendingRequests = 0;
  private suppressLateEvents = false;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: ClaudeProviderDeps) {
    this.stream = new ClaudeStream({
      emit: (e) => this.emit(e),
      session: (sessionId) => this.onSession(sessionId),
      result: (status, error) => {
        this.outcome = { status, error };
      },
    });
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isRunning(): boolean {
    return this.running;
  }

  stderrSummary(limit = STDERR_IN_MESSAGE): string {
    return this.stderrTail.replace(/\s+/g, ' ').trim().slice(-limit);
  }

  async start(opts: StartOptions): Promise<{ threadId: string }> {
    this.stopping = false;
    this.stderrTail = '';
    this.emit({ type: 'status', status: 'starting' });
    const explicit = opts.settings.claude.binPath ?? null;
    const found = await (this.deps.binary ? this.deps.binary(explicit) : resolveClaudeBinary(explicit));
    if (!found) {
      const message = claudeMissingMessage(explicit);
      this.emit({ type: 'status', status: 'error', message });
      throw new Error(message);
    }
    this.binaryPath = found;
    this.tools = opts.tools;
    this.settings = opts.settings.claude;
    this.workspaceDir = opts.workspaceDir;
    // A resumed session already exists on disk; a new one is named here so the app has a thread id
    // to record against before the CLI has ever run.
    this.threadId = opts.threadId ?? randomUUID();
    this.sessionEstablished = Boolean(opts.threadId);
    this.emit({ type: 'thread', threadId: this.threadId });
    this.emit({ type: 'status', status: 'ready' });
    return { threadId: this.threadId };
  }

  async send(text: string, pageContext?: PageContext | null): Promise<void> {
    if (!this.threadId || !this.binaryPath || !this.settings) throw new Error('provider not started');
    const full = buildTurnText(text, pageContext, this.lastContextKey);
    this.lastContextKey = contextKey(pageContext) ?? this.lastContextKey;
    this.emit({ type: 'user.message', text });
    this.running = true;
    this.interrupted = false;
    this.suppressLateEvents = false;
    this.turnAbort = new AbortController();
    this.turnId = randomUUID();
    this.emit({ type: 'status', status: 'running' });
    this.emit({ type: 'turn.started', turnId: this.turnId });
    this.touchIdle();
    void this.runTurn(full);
  }

  async interrupt(): Promise<void> {
    if (!this.running) return;
    this.interrupted = true;
    const controller = this.turnAbort;
    try {
      await this.query?.interrupt();
    } catch {
      // The CLI may already be gone; the abort below ends the turn either way.
    } finally {
      controller?.abort(new Error('The turn was interrupted'));
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return CLAUDE_MODELS;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearIdle();
    this.abortTurn(new Error('The agent was stopped'));
    this.query = null;
    this.running = false;
  }

  /** One turn, retried once when the session it wanted to resume has been deleted under us. */
  private async runTurn(prompt: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const resume = this.sessionEstablished ? this.threadId : null;
      this.outcome = null;
      let thrown: string | null = null;
      try {
        const handle = this.deps.runQuery({
          prompt,
          tools: this.claudeTools(),
          options: {
            pathToClaudeCodeExecutable: this.binaryPath!,
            cwd: this.workspaceDir,
            env: await this.spawnEnv(),
            systemPrompt: DEVELOPER_INSTRUCTIONS,
            model: this.settings!.model,
            effort: this.settings!.effort,
            webSearch: this.settings!.webSearch === 'on',
            resume,
            sessionId: this.threadId!,
            abortController: this.turnAbort ?? new AbortController(),
            stderr: (line) => {
              this.stderrTail = (this.stderrTail + line).slice(-STDERR_KEEP);
            },
          },
        });
        this.query = handle;
        for await (const message of handle) {
          this.touchIdle();
          this.stream.handle(message);
        }
      } catch (err) {
        thrown = err instanceof Error ? err.message : String(err);
      } finally {
        this.query = null;
      }
      if (this.stopping) return;
      const outcome: { status: 'completed' | 'failed'; error?: string } = this.outcome ?? {
        status: 'failed',
        error: thrown ?? 'Claude ended the turn without a result',
      };
      if (attempt === 0 && resume && MISSING_SESSION.test(outcome.error ?? '')) {
        this.threadId = randomUUID();
        this.sessionEstablished = false;
        this.emit({ type: 'thread', threadId: this.threadId });
        this.emit({ type: 'status', status: 'starting', message: 'That Claude conversation is gone; XPilot started a new one.' });
        continue;
      }
      if (outcome.status === 'completed') {
        this.finishTurn('completed');
        return;
      }
      this.finishTurn(this.interrupted ? 'interrupted' : 'failed', this.failureMessage(outcome.error));
      return;
    }
  }

  /** A failure with nothing to say borrows the CLI's stderr, which is where auth errors surface. */
  private failureMessage(error: string | undefined): string {
    const tail = this.stderrSummary();
    if (error && tail && !error.includes(tail)) return `${error}: ${tail}`;
    return error || tail || 'Claude failed the turn';
  }

  private spawnEnv(): Promise<NodeJS.ProcessEnv> {
    const binary = this.binaryPath!;
    if (this.deps.env) return this.deps.env(binary);
    return claudeSpawnEnv(binary).then((env) => ({
      ...env,
      // Isolation, alongside settingSources: []. Neither the user's memory files nor the connectors
      // they use in their own Claude Code belong in an XPilot turn.
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    }));
  }

  /** Our tools as the SDK wants them; the handler reports the call and answers with fenced output. */
  private claudeTools(): ClaudeTool[] {
    return this.tools.map((spec) => ({
      name: spec.name,
      description: spec.description,
      shape: toolShape(spec.inputSchema),
      handler: async (args: Record<string, unknown>) => {
        const itemId = this.stream.ownToolStarted(spec.name, args);
        this.emit({ type: 'tool.started', itemId, name: spec.name, args });
        this.pendingRequests++;
        let result: ToolResult;
        try {
          result = await this.deps.callTool(spec.name, args ?? {}, this.turnAbort?.signal);
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
          this.pendingRequests--;
          this.touchIdle();
        }
        const text = toolResultText(result);
        this.stream.ownToolCompleted(itemId);
        this.emit({ type: 'tool.completed', itemId, name: spec.name, success: result.success, output: text });
        return { content: [{ type: 'text' as const, text }], isError: !result.success };
      },
    }));
  }

  private onSession(sessionId: string): void {
    if (sessionId !== this.threadId) {
      this.threadId = sessionId;
      this.emit({ type: 'thread', threadId: sessionId });
    }
    this.sessionEstablished = true;
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

  /** Anything from the CLI counts as progress; the countdown starts again from here. */
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
    if (this.pendingRequests > 0) {
      this.armIdle();
      return;
    }
    if (!this.idleWarned) {
      this.idleWarned = true;
      this.emit({ type: 'activity', activity: 'waiting' });
      this.armIdle();
      return;
    }
    const { timeout } = this.idleLimits();
    const message = `Claude sent nothing for ${Math.round(timeout / 1000)}s, so XPilot stopped waiting for this turn.`;
    this.suppressLateEvents = true;
    void this.interrupt().catch(() => undefined);
    this.finishTurn('failed', message);
    this.emit({ type: 'status', status: 'error', message: `${message} Press Stop, then Reconnect, if the agent stays stuck.` });
  }

  private emit(e: AgentEvent): void {
    if (this.suppressLateEvents && !LIFECYCLE_EVENTS.has(e.type)) return;
    if (e.type === 'activity') {
      const key = `${e.activity}:${e.detail ?? ''}`;
      if (key === this.lastActivity) return; // consecutive duplicates carry no information
      this.lastActivity = key;
    } else if (e.type === 'turn.started' || e.type === 'turn.completed') this.lastActivity = null;
    for (const cb of this.listeners) cb(e);
  }

  /** Idempotent: no-ops unless a turn is actually running, so a racing abort cannot double-fire. */
  private finishTurn(status: 'completed' | 'interrupted' | 'failed', error?: string): void {
    if (!this.running) return;
    this.running = false;
    this.clearIdle();
    this.abortTurn(new Error(`The turn ${status}`));
    this.emit({ type: 'turn.completed', turnId: this.turnId ?? '', status, error });
    this.emit({ type: 'status', status: 'ready' });
  }
}
