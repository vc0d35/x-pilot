import { createHash } from 'node:crypto';
import type { AgentEvent } from '../../shared/agent';
import type { PageContext } from '../../shared/page';
import type { SettingsStore } from '../settings';
import type { ToolSpec } from '../../shared/tools';
import type { ToolRegistry } from '../tools/registry';
import type { AgentProvider, ModelInfo } from './provider';

/** Stable fingerprint of the dynamic tools a thread was started with. */
export function toolsFingerprint(tools: ToolSpec[]): string {
  return createHash('sha256').update(JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema]))).digest('hex');
}

export interface AgentControllerDeps {
  registry: ToolRegistry;
  settings: SettingsStore;
  workspaceDir: string;
  createProvider: () => AgentProvider;
}

export class AgentController {
  private provider: AgentProvider | null = null;
  private unsubscribe: (() => void) | null = null;
  private restartedOnce = false;
  private generation = 0;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(private readonly deps: AgentControllerDeps) {}

  onEvent(cb: (e: AgentEvent) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  async start(opts: { resume: boolean }): Promise<void> {
    const gen = ++this.generation;
    await this.stop();
    if (gen !== this.generation) return; // superseded by a newer start() while we awaited stop()
    if (!opts.resume) this.deps.settings.update({ threadId: null, threadToolsHash: null });
    const tools = this.deps.registry.list();
    const toolsHash = toolsFingerprint(tools);
    const stored = this.deps.settings.get();
    let resumeThreadId: string | null = null;
    if (opts.resume && stored.threadId) {
      if (stored.threadToolsHash === toolsHash) resumeThreadId = stored.threadId;
      else console.log('[xpilot] tool list changed since the stored thread; starting a fresh thread');
    }
    const provider = this.deps.createProvider();
    const unsubscribe = provider.onEvent((e) => {
      this.emit(e);
      if (e.type === 'turn.completed') this.restartedOnce = false;
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
      this.deps.settings.update({ threadId, threadToolsHash: toolsHash });
    } catch (err) {
      if (gen !== this.generation) { unsubscribe(); void provider.stop(); return; }
      this.emit({ type: 'status', status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

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
