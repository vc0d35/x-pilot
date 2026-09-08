import { createHash } from 'node:crypto';
import type { AgentEvent } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { SettingsStore } from '../settings';
import type { ToolSpec } from '../../shared/tools';
import type { ToolRegistry } from '../tools/registry';
import type { HistoryStore } from '../history/store';
import type { Conversation } from '../../shared/sidebar-api';
import type { AgentProvider, ModelInfo } from './provider';

/** Tool output beyond this is elided in the stored transcript; a full page read can be megabytes. */
export const MAX_TRANSCRIPT_OUTPUT = 4000;

/** Events worth keeping in a conversation transcript (deltas and activity are transient). */
export const RECORDED = new Set<AgentEvent['type']>(['user.message', 'message.completed', 'thinking.completed', 'tool.started', 'tool.completed', 'turn.completed']);

/** The form of an event that goes into a stored transcript. */
export function transcriptEvent(e: AgentEvent): AgentEvent {
  if (e.type !== 'tool.completed' || e.output.length <= MAX_TRANSCRIPT_OUTPUT) return e;
  return { ...e, output: e.output.slice(0, MAX_TRANSCRIPT_OUTPUT) + '… [truncated]' };
}

/** Stable fingerprint of the dynamic tools a thread was started with. */
export function toolsFingerprint(tools: ToolSpec[]): string {
  return createHash('sha256').update(JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema]))).digest('hex');
}

export interface AgentControllerDeps {
  registry: ToolRegistry;
  settings: SettingsStore;
  workspaceDir: string;
  createProvider: () => AgentProvider;
  /** Conversation store; optional so lightweight tests can omit it. */
  history?: HistoryStore;
}

export class AgentController {
  private provider: AgentProvider | null = null;
  private threadId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private restartedOnce = false;
  private restartPending = false;
  private generation = 0;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: AgentControllerDeps) {}

  onEvent(cb: (e: AgentEvent) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Restarts the provider now, or after the turn in flight so a running answer is not cut off. */
  restartWhenIdle(): void {
    if (this.provider?.isRunning()) { this.restartPending = true; return; }
    this.restartPending = false;
    void this.start({ resume: true });
  }

  async start(opts: { resume: boolean; threadId?: string | null }): Promise<void> {
    const gen = ++this.generation;
    await this.stop();
    if (gen !== this.generation) return; // superseded by a newer start() while we awaited stop()
    if (!opts.resume) this.deps.settings.update({ threadId: null, threadToolsHash: null });
    // Resuming a stored conversation compares the hash the thread was started with, not the current one.
    else if (opts.threadId) this.deps.settings.update({ threadId: opts.threadId, threadToolsHash: this.deps.history?.getConversation(opts.threadId)?.toolsHash ?? null });
    this.threadId = null;
    const tools = this.deps.registry.list();
    const toolsHash = toolsFingerprint(tools);
    const stored = this.deps.settings.get();
    let resumeThreadId: string | null = null;
    if (opts.resume && stored.threadId) {
      if (stored.threadToolsHash === toolsHash) resumeThreadId = stored.threadId;
      else this.emit({ type: 'status', status: 'starting', message: 'XPilot\u2019s tools changed since that conversation, so it cannot be resumed; starting a fresh thread.' });
    }
    const provider = this.deps.createProvider();
    const unsubscribe = provider.onEvent((e) => {
      this.emit(e);
      if (this.threadId && RECORDED.has(e.type)) this.deps.history?.appendEvent(this.threadId, transcriptEvent(e));
      if (e.type === 'turn.completed') {
        this.restartedOnce = false;
        if (this.restartPending && this.provider === provider) { this.restartPending = false; void this.start({ resume: true }); }
      }
      if (e.type === 'status' && e.status === 'disconnected' && this.provider === provider && !this.restartedOnce) {
        this.restartedOnce = true;
        this.emit({ type: 'status', status: 'starting', message: 'Codex exited; restarting once' });
        void this.start({ resume: true });
      }
    });
    this.unsubscribe = unsubscribe;
    this.provider = provider;
    try {
      const { threadId } = await provider.start({
        tools,
        settings: this.deps.settings.get().agent.codex,
        threadId: resumeThreadId,
        workspaceDir: this.deps.workspaceDir,
      });
      if (gen !== this.generation) { unsubscribe(); void provider.stop(); return; }
      this.threadId = threadId;
      this.deps.history?.upsertConversation({ threadId, kind: 'chat', toolsHash });
      this.deps.history?.pruneEmptyConversations(threadId);
      this.deps.settings.update({ threadId, threadToolsHash: toolsHash });
    } catch (err) {
      if (gen !== this.generation) { unsubscribe(); void provider.stop(); return; }
      this.emit({ type: 'status', status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Resumes a stored conversation and returns its transcript for the UI to replay. */
  async openConversation(threadId: string): Promise<AgentEvent[]> {
    // Already in it: nothing to restart (an empty thread cannot even be resumed by Codex yet).
    if (threadId !== this.threadId || !this.provider) await this.start({ resume: true, threadId });
    return this.deps.history?.listEvents(threadId) ?? [];
  }

  listConversations(): Conversation[] { return this.deps.history?.listConversations() ?? []; }

  currentThreadId(): string | null { return this.threadId; }

  async send(text: string, ctx: PageContext | null): Promise<void> {
    if (!this.provider) throw new Error('Agent is not running');
    await this.provider.send(text, ctx);
  }

  async interrupt(): Promise<void> { await this.provider?.interrupt(); }
  async listModels(): Promise<ModelInfo[]> { return this.provider?.listModels() ?? []; }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const provider = this.provider;
    this.provider = null;
    await provider?.stop();
  }

  private emit(e: AgentEvent): void { for (const cb of this.listeners) cb(e); }
}
