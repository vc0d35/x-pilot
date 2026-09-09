import { createHash } from 'node:crypto';
import type { AgentEvent, ProviderKind } from '../../shared/agent';
import { PROVIDER_LABELS } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { SettingsStore } from '../settings';
import type { ToolSpec } from '../../shared/tools';
import type { ToolRegistry } from '../tools/registry';
import type { AppStore } from '../history/store';
import type { Conversation, ModelList, OpenedConversation, ProbeResult } from '../../shared/sidebar-api';
import type { AgentProvider, ModelInfo } from './provider';
import { staticModels } from './providers';
import { ThreadState } from './thread-state';

/** Tool output beyond this is elided in the stored transcript; a full page read can be megabytes. */
export const MAX_TRANSCRIPT_OUTPUT = 4000;

/** What the sidebar shows until the user picks a backend in the first-run card. */
export const NO_PROVIDER_MESSAGE = 'Choose a model to connect';

/** How long a Connect probe may take before it is called a failure. */
export const PROBE_TIMEOUT_MS = 60_000;
const PROBE_PROMPT = 'Reply with the single word OK.';

/** Events worth keeping in a conversation transcript (deltas and activity are transient). */
export const RECORDED = new Set<AgentEvent['type']>([
  'user.message',
  'message.completed',
  'thinking.completed',
  'tool.started',
  'tool.completed',
  'turn.completed',
]);

export function transcriptEvent(e: AgentEvent): AgentEvent {
  if (e.type !== 'tool.completed' || e.output.length <= MAX_TRANSCRIPT_OUTPUT) return e;
  return { ...e, output: e.output.slice(0, MAX_TRANSCRIPT_OUTPUT) + '… [truncated]' };
}

export function toolsFingerprint(tools: ToolSpec[]): string {
  return createHash('sha256')
    .update(JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema])))
    .digest('hex');
}

export interface AgentControllerDeps {
  registry: ToolRegistry;
  settings: SettingsStore;
  workspaceDir: string;
  createProvider: (kind: ProviderKind) => AgentProvider;
  /** Conversation store; optional so lightweight tests can omit it. */
  store?: AppStore;
  /** Where the live thread id and its tool fingerprint are kept; defaults to a file beside settings.json. */
  threadState?: ThreadState;
}

export class AgentController {
  private provider: AgentProvider | null = null;
  private threadId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private restartedOnce = false;
  private restartPending = false;
  private switching = false;
  private generation = 0;
  /** The last model list each provider reported, so Settings can show one that is not running. */
  private readonly knownModels = new Map<ProviderKind, ModelInfo[]>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  private readonly threadState: ThreadState;

  constructor(private readonly deps: AgentControllerDeps) {
    this.threadState = deps.threadState ?? ThreadState.beside(deps.settings.filePath);
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Which backend is driving the agent, as settings say; null until the user has chosen. */
  activeProvider(): ProviderKind | null {
    return this.deps.settings.get().agent.provider;
  }

  /** Restarts the provider now, or after the turn in flight so a running answer is not cut off. */
  restartWhenIdle(): void {
    if (this.switching) return; // switchProvider is already starting a fresh thread
    if (this.provider?.isRunning()) {
      this.restartPending = true;
      return;
    }
    this.restartPending = false;
    void this.start({ resume: true });
  }

  /** The Settings picker: stop what is running, record the choice, and start a fresh thread on it. */
  async switchProvider(kind: ProviderKind): Promise<void> {
    this.switching = true;
    try {
      await this.stop();
      this.deps.settings.update({ agent: { provider: kind } });
      await this.start({ resume: false });
    } finally {
      this.switching = false;
    }
  }

  async start(opts: { resume: boolean; threadId?: string | null }): Promise<void> {
    // A scheduled run's thread belongs to that run's own process; binding the interactive agent to
    // it would restart the backend on it and, mid-run, put two processes on one thread.
    if (opts.threadId && this.deps.store?.getConversation(opts.threadId)?.kind === 'task') {
      console.warn(`[xpilot] refusing to resume ${opts.threadId}: it is a scheduled run's thread`);
      return;
    }
    const gen = ++this.generation;
    await this.stop();
    if (gen !== this.generation) return; // superseded by a newer start() while we awaited stop()
    const kind = this.activeProvider();
    if (!kind) {
      this.threadId = null;
      this.emit({ type: 'status', status: 'disconnected', message: NO_PROVIDER_MESSAGE });
      return;
    }
    if (!opts.resume) this.threadState.set({ threadId: null, threadToolsHash: null, provider: null });
    // Resuming a stored conversation compares the hash the thread was started with, not the current one.
    else if (opts.threadId) {
      const stored = this.deps.store?.getConversation(opts.threadId);
      this.threadState.set({
        threadId: opts.threadId,
        threadToolsHash: stored?.toolsHash ?? null,
        provider: stored?.provider ?? kind,
      });
    }
    this.threadId = null;
    const tools = this.deps.registry.list();
    const toolsHash = toolsFingerprint(tools);
    const provider = this.deps.createProvider(kind);
    const resumeThreadId = this.resumeThreadId(opts.resume, provider, toolsHash);
    const unsubscribe = provider.onEvent((e) => {
      this.emit(e);
      // A provider may re-point its thread mid-turn (Claude does when the session it resumed is
      // gone), so the transcript follows the thread it reports rather than the one start() returned.
      if (e.type === 'thread' && e.threadId !== this.threadId && this.provider === provider) this.bindThread(e.threadId, toolsHash, kind);
      if (this.threadId && RECORDED.has(e.type)) this.deps.store?.appendEvent(this.threadId, transcriptEvent(e));
      if (e.type === 'turn.completed') {
        this.restartedOnce = false;
        if (this.restartPending && this.provider === provider) {
          this.restartPending = false;
          void this.start({ resume: true });
        }
      }
      if (e.type === 'status' && e.status === 'disconnected' && this.provider === provider && !this.restartedOnce) {
        this.restartedOnce = true;
        this.emit({ type: 'status', status: 'starting', message: `${PROVIDER_LABELS[kind]} exited; restarting once` });
        void this.start({ resume: true });
      }
    });
    this.unsubscribe = unsubscribe;
    this.provider = provider;
    try {
      const { threadId } = await provider.start({
        tools,
        settings: this.deps.settings.get().agent,
        threadId: resumeThreadId,
        workspaceDir: this.deps.workspaceDir,
      });
      if (gen !== this.generation) {
        unsubscribe();
        void provider.stop();
        return;
      }
      this.bindThread(threadId, toolsHash, kind);
      this.deps.store?.pruneEmptyConversations(threadId);
    } catch (err) {
      if (gen !== this.generation) {
        unsubscribe();
        void provider.stop();
        return;
      }
      this.emit({ type: 'status', status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * The thread to resume, or null for a fresh one. A thread started under the other provider is
   * never resumed, and a provider that freezes its tools at thread start refuses a thread whose
   * tool fingerprint has since changed.
   */
  private resumeThreadId(resume: boolean, provider: AgentProvider, toolsHash: string): string | null {
    const stored = this.threadState.get();
    if (!resume || !stored.threadId) return null;
    if (stored.provider && stored.provider !== provider.kind) {
      this.emit({
        type: 'status',
        status: 'starting',
        message: `That conversation belongs to ${PROVIDER_LABELS[stored.provider]}, so ${PROVIDER_LABELS[provider.kind]} is starting a fresh one.`,
      });
      return null;
    }
    if (provider.capabilities.toolsFrozenPerThread && stored.threadToolsHash !== toolsHash) {
      this.emit({
        type: 'status',
        status: 'starting',
        message: 'XPilot’s tools changed since that conversation, so it cannot be resumed; starting a fresh thread.',
      });
      return null;
    }
    return stored.threadId;
  }

  private bindThread(threadId: string, toolsHash: string, provider: ProviderKind): void {
    this.threadId = threadId;
    this.deps.store?.upsertConversation({ threadId, kind: 'chat', toolsHash, provider });
    this.threadState.set({ threadId, threadToolsHash: toolsHash, provider });
  }

  /**
   * Opens a conversation for the sidebar. A scheduled run is a read-only view: its transcript is
   * returned as it stands and the live thread and provider are left alone, because the run has its
   * own process. A conversation another provider wrote is read-only too, because only the provider
   * that owns a thread can continue it. Anything else is the user's own conversation, so it is resumed.
   */
  async openConversation(threadId: string): Promise<OpenedConversation> {
    const conversation = this.deps.store?.getConversation(threadId);
    const events = (): AgentEvent[] => this.deps.store?.listEvents(threadId) ?? [];
    if (conversation?.kind === 'task') {
      const task = conversation.taskId === null ? null : this.deps.store?.getTask(conversation.taskId);
      return {
        events: events(),
        view: {
          threadId,
          kind: 'task',
          taskId: conversation.taskId,
          title: task?.title ?? conversation.title,
          running: task?.lastStatus === 'running',
        },
      };
    }
    const active = this.activeProvider();
    if (conversation && conversation.provider !== active)
      return { events: events(), view: { threadId, kind: 'foreign', provider: conversation.provider } };
    // Already in it: nothing to restart (an empty thread cannot even be resumed yet).
    if (threadId !== this.threadId || !this.provider) await this.start({ resume: true, threadId });
    return { events: events(), view: { threadId: this.threadId ?? threadId, kind: 'live' } };
  }

  listConversations(): Conversation[] {
    return this.deps.store?.listConversations() ?? [];
  }

  currentThreadId(): string | null {
    return this.threadId;
  }

  async send(text: string, ctx: PageContext | null): Promise<void> {
    if (!this.provider) throw new Error('Agent is not running');
    await this.provider.send(text, ctx);
  }

  async interrupt(): Promise<void> {
    await this.provider?.interrupt();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.modelsFor(this.activeProvider()).then((r) => r.models);
  }

  /**
   * The models to offer for one provider. The running provider is asked; another one answers from
   * its static list, or from what it last reported, and says so when it has nothing.
   */
  async modelsFor(kind: ProviderKind | null): Promise<ModelList> {
    if (!kind) return { provider: 'codex', models: [], unavailable: true };
    if (this.provider?.kind === kind) {
      try {
        const models = await this.provider.listModels();
        if (models.length > 0) this.knownModels.set(kind, models);
        return { provider: kind, models, unavailable: models.length === 0 };
      } catch (err) {
        console.warn(`[xpilot] ${kind} model list failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const models = staticModels(kind).length > 0 ? staticModels(kind) : (this.knownModels.get(kind) ?? []);
    return { provider: kind, models, unavailable: models.length === 0 };
  }

  /**
   * The Connect button: a throwaway provider of its own, one short turn, and then away again. It
   * never touches the live thread, so a probe of the provider that is not chosen is harmless.
   */
  async probeProvider(kind: ProviderKind, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
    const provider = this.deps.createProvider(kind);
    const agent = this.deps.settings.get().agent;
    const model = (kind === 'claude' ? agent.claude.model : agent.codex.model) ?? null;
    try {
      let settle!: (r: ProbeResult) => void;
      const done = new Promise<ProbeResult>((resolve) => {
        settle = resolve;
        provider.onEvent((e) => {
          if (e.type === 'turn.completed')
            resolve(e.status === 'completed' ? { ok: true, model } : { ok: false, error: e.error ?? `The turn ${e.status}` });
          if (e.type === 'status' && (e.status === 'error' || e.status === 'disconnected'))
            resolve({ ok: false, error: e.message ?? `${PROVIDER_LABELS[kind]} disconnected` });
        });
      });
      const timer = setTimeout(() => settle({ ok: false, error: `${PROVIDER_LABELS[kind]} did not answer in time` }), timeoutMs);
      try {
        await provider.start({ tools: [], settings: agent, threadId: null, workspaceDir: this.deps.workspaceDir });
        await provider.send(PROBE_PROMPT, null);
        return await done;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await provider.stop().catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const provider = this.provider;
    this.provider = null;
    await provider?.stop();
  }

  private emit(e: AgentEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
